import type { DanceProject, StoredWaveform } from '@/domain/project';
import {
  StoredDanceProjectSchema,
  StoredWaveformSchema,
  migrateLegacyDanceProject,
} from '@/domain/validation';
import {
  IMPORT_DIRECTORY_PREFIX,
  IMPORT_METADATA_FILE_NAME,
  ImportTransactionJournalSchema,
  type ImportTransactionJournal,
  PROJECT_AUDIO_FILE_NAME,
  PROJECT_METADATA_BACKUP_FILE_NAME,
  PROJECT_METADATA_FILE_NAME,
  PROJECT_METADATA_TEMP_FILE_NAME,
  PROJECT_WAVEFORM_BACKUP_FILE_NAME,
  PROJECT_WAVEFORM_FILE_NAME,
  PROJECT_WAVEFORM_TEMP_FILE_NAME,
  type StorageEntry,
  StorageLayout,
  storageLayout,
} from '@/services/StorageLayout';

export const TRANSIENT_MAX_AGE_MS = 60 * 60 * 1000;

export type ProjectRepairIssue =
  'AUDIO_MISSING_OR_EMPTY' | 'WAVEFORM_MISSING' | 'WAVEFORM_INVALID' | 'WAVEFORM_DURATION_MISMATCH';

export interface ProjectMediaStatus {
  readonly state: 'ready' | 'needs-repair';
  readonly issues: readonly ProjectRepairIssue[];
}

export type RecoveryDiagnostic =
  | {
      readonly code: 'STALE_IMPORT_REMOVED';
      readonly importId: string;
    }
  | {
      readonly code: 'STALE_TEMP_FILE_REMOVED';
      readonly projectId: string;
      readonly fileName: string;
    }
  | {
      readonly code: 'CORRUPT_PROJECT_METADATA';
      readonly projectId: string;
    }
  | {
      readonly code: 'PROJECT_NEEDS_REPAIR';
      readonly projectId: string;
      readonly issues: readonly ProjectRepairIssue[];
    }
  | {
      readonly code: 'JSON_BACKUP_RESTORED' | 'JSON_TEMP_COMMITTED' | 'JSON_BACKUP_REMOVED';
      readonly projectId: string;
      readonly fileName: string;
    };

export interface RecoveryReport {
  readonly removedImportIds: readonly string[];
  readonly removedTemporaryFiles: readonly string[];
  readonly corruptProjectIds: readonly string[];
  readonly repairProjectIds: readonly string[];
  readonly diagnostics: readonly RecoveryDiagnostic[];
}

export interface RecoveryServiceOptions {
  readonly now?: () => number;
  readonly transientMaxAgeMs?: number;
  readonly onDiagnostic?: (diagnostic: RecoveryDiagnostic) => void;
}

function emptyMediaStatus(): ProjectMediaStatus {
  return { state: 'ready', issues: [] };
}

export class RecoveryService {
  private readonly now: () => number;
  private readonly transientMaxAgeMs: number;
  private readonly onDiagnostic?: (diagnostic: RecoveryDiagnostic) => void;

  constructor(
    private readonly layout: StorageLayout = storageLayout,
    options: RecoveryServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.transientMaxAgeMs = options.transientMaxAgeMs ?? TRANSIENT_MAX_AGE_MS;
    this.onDiagnostic = options.onDiagnostic;
  }

  async recover(): Promise<RecoveryReport> {
    const diagnostics: RecoveryDiagnostic[] = [];
    const protectedImportIds = await this.recoverProjectJsonJournals(diagnostics);
    const removedImportIds = this.removeStaleImportDirectories(diagnostics, protectedImportIds);
    const removedTemporaryFiles = await this.removeStaleProjectTemporaryFiles(diagnostics);

    diagnostics.forEach((diagnostic) => this.onDiagnostic?.(diagnostic));
    return {
      removedImportIds,
      removedTemporaryFiles,
      corruptProjectIds: [],
      repairProjectIds: [],
      diagnostics,
    };
  }

  async inspectProjectMedia(project: DanceProject): Promise<ProjectMediaStatus> {
    const issues: ProjectRepairIssue[] = [];
    const audioUri = this.layout.projectAudioUri(project.id);
    const waveformUri = this.layout.projectWaveformUri(project.id);

    if (
      !this.layout.fileSystem.fileExists(audioUri) ||
      this.layout.fileSystem.fileSize(audioUri) <= 0
    ) {
      issues.push('AUDIO_MISSING_OR_EMPTY');
    }

    if (project.waveformStatus !== 'ready') {
      // Pending and failed waveforms do not make otherwise playable audio a
      // damaged project. The foreground coordinator resumes or retries them.
    } else if (!this.layout.fileSystem.fileExists(waveformUri)) {
      issues.push('WAVEFORM_MISSING');
    } else {
      try {
        const raw: unknown = JSON.parse(await this.layout.fileSystem.readText(waveformUri));
        const parsed = StoredWaveformSchema.safeParse(raw);
        if (!parsed.success) {
          issues.push('WAVEFORM_INVALID');
        } else if (parsed.data.durationMs !== project.durationMs) {
          issues.push('WAVEFORM_DURATION_MISMATCH');
        }
      } catch {
        issues.push('WAVEFORM_INVALID');
      }
    }

    return issues.length === 0 ? emptyMediaStatus() : { state: 'needs-repair', issues };
  }

  private async recoverProjectJsonJournals(
    diagnostics: RecoveryDiagnostic[],
  ): Promise<ReadonlySet<string>> {
    const protectedImportIds = new Set<string>();
    for (const projectEntry of this.safeListDirectory(this.layout.projectsDirectoryUri)) {
      if (projectEntry.kind !== 'directory') {
        continue;
      }

      const project = await this.recoverProjectMetadataJournal(
        projectEntry,
        diagnostics,
        protectedImportIds,
      );
      if (project !== null) {
        await this.recoverWaveformJournal(projectEntry, project, diagnostics);
      }
    }
    return protectedImportIds;
  }

  private async recoverProjectMetadataJournal(
    projectEntry: StorageEntry,
    diagnostics: RecoveryDiagnostic[],
    protectedImportIds: Set<string>,
  ): Promise<DanceProject | null> {
    const destinationUri = this.layout.fileSystem.join(
      projectEntry.uri,
      PROJECT_METADATA_FILE_NAME,
    );
    const temporaryUri = this.layout.fileSystem.join(
      projectEntry.uri,
      PROJECT_METADATA_TEMP_FILE_NAME,
    );
    const backupUri = this.layout.fileSystem.join(
      projectEntry.uri,
      PROJECT_METADATA_BACKUP_FILE_NAME,
    );

    const committed = await this.readProject(destinationUri, projectEntry.name);
    if (committed !== null) {
      this.removeRedundantBackup(backupUri, projectEntry.name, diagnostics);
      this.removeFileBestEffort(
        this.layout.fileSystem.join(projectEntry.uri, IMPORT_METADATA_FILE_NAME),
      );
      return committed;
    }

    const backup = await this.readProject(backupUri, projectEntry.name);
    if (backup !== null) {
      try {
        await this.layout.fileSystem.copyFile(backupUri, destinationUri);
      } catch {
        return null;
      }

      const restored = await this.readProject(destinationUri, projectEntry.name);
      if (restored !== null) {
        diagnostics.push({
          code: 'JSON_BACKUP_RESTORED',
          projectId: projectEntry.name,
          fileName: PROJECT_METADATA_FILE_NAME,
        });
        this.removeRedundantBackup(backupUri, projectEntry.name, diagnostics);
        this.removeFileBestEffort(
          this.layout.fileSystem.join(projectEntry.uri, IMPORT_METADATA_FILE_NAME),
        );
        return restored;
      }
      return null;
    }

    let sourceImportDirectoryUri: string | null = null;
    try {
      sourceImportDirectoryUri = this.layout.importDirectoryUri(projectEntry.name);
    } catch {
      // An unsafe directory name cannot identify an app-owned import transaction.
    }
    if (
      sourceImportDirectoryUri !== null &&
      this.layout.fileSystem.directoryExists(sourceImportDirectoryUri)
    ) {
      let targetRemoved = false;
      try {
        this.layout.fileSystem.deleteDirectory(projectEntry.uri);
        targetRemoved = !this.layout.fileSystem.directoryExists(projectEntry.uri);
      } catch {
        // Keep the source and leave this uncommitted target invisible for a later retry.
      }
      if (!targetRemoved) {
        protectedImportIds.add(projectEntry.name);
      }
      return null;
    }

    const temporary = await this.readProject(temporaryUri, projectEntry.name);
    if (temporary === null) {
      return null;
    }

    if (!(await this.hasCompleteProjectMedia(projectEntry.uri, temporary))) {
      return null;
    }

    try {
      await this.layout.fileSystem.moveFile(temporaryUri, destinationUri);
    } catch {
      // A native move may report failure after completing. Validate below.
    }

    const recovered = await this.readProject(destinationUri, projectEntry.name);
    if (recovered !== null) {
      diagnostics.push({
        code: 'JSON_TEMP_COMMITTED',
        projectId: projectEntry.name,
        fileName: PROJECT_METADATA_FILE_NAME,
      });
      this.removeFileBestEffort(
        this.layout.fileSystem.join(projectEntry.uri, IMPORT_METADATA_FILE_NAME),
      );
    }
    return recovered;
  }

  private async recoverWaveformJournal(
    projectEntry: StorageEntry,
    project: DanceProject,
    diagnostics: RecoveryDiagnostic[],
  ): Promise<void> {
    const destinationUri = this.layout.fileSystem.join(
      projectEntry.uri,
      PROJECT_WAVEFORM_FILE_NAME,
    );
    const temporaryUri = this.layout.fileSystem.join(
      projectEntry.uri,
      PROJECT_WAVEFORM_TEMP_FILE_NAME,
    );
    const backupUri = this.layout.fileSystem.join(
      projectEntry.uri,
      PROJECT_WAVEFORM_BACKUP_FILE_NAME,
    );

    if ((await this.readWaveform(destinationUri, project.durationMs)) !== null) {
      this.removeRedundantBackup(backupUri, project.id, diagnostics);
      return;
    }

    if ((await this.readWaveform(backupUri, project.durationMs)) !== null) {
      try {
        await this.layout.fileSystem.copyFile(backupUri, destinationUri);
      } catch {
        return;
      }
      if ((await this.readWaveform(destinationUri, project.durationMs)) !== null) {
        diagnostics.push({
          code: 'JSON_BACKUP_RESTORED',
          projectId: project.id,
          fileName: PROJECT_WAVEFORM_FILE_NAME,
        });
        this.removeRedundantBackup(backupUri, project.id, diagnostics);
      }
      return;
    }

    if ((await this.readWaveform(temporaryUri, project.durationMs)) === null) {
      return;
    }

    try {
      await this.layout.fileSystem.moveFile(temporaryUri, destinationUri);
    } catch {
      // Validate the destination because the underlying move may have completed.
    }
    if ((await this.readWaveform(destinationUri, project.durationMs)) !== null) {
      diagnostics.push({
        code: 'JSON_TEMP_COMMITTED',
        projectId: project.id,
        fileName: PROJECT_WAVEFORM_FILE_NAME,
      });
    }
  }

  private async hasCompleteProjectMedia(
    projectDirectoryUri: string,
    project: DanceProject,
  ): Promise<boolean> {
    if (this.layout.fileSystem.directoryExists(this.layout.importDirectoryUri(project.id))) {
      return false;
    }

    const journalUri = this.layout.fileSystem.join(projectDirectoryUri, IMPORT_METADATA_FILE_NAME);
    const journal = await this.readImportJournal(journalUri);
    if (
      journal === null ||
      journal.projectId !== project.id ||
      journal.durationMs !== project.durationMs
    ) {
      return false;
    }

    const audioUri = this.layout.fileSystem.join(projectDirectoryUri, PROJECT_AUDIO_FILE_NAME);
    if (
      !this.layout.fileSystem.fileExists(audioUri) ||
      this.layout.fileSystem.fileSize(audioUri) !== journal.expectedAudioSizeBytes
    ) {
      return false;
    }

    return true;
  }

  private async readImportJournal(uri: string): Promise<ImportTransactionJournal | null> {
    if (!this.layout.fileSystem.fileExists(uri)) {
      return null;
    }
    try {
      const raw: unknown = JSON.parse(await this.layout.fileSystem.readText(uri));
      const parsed = ImportTransactionJournalSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async readProject(uri: string, expectedProjectId: string): Promise<DanceProject | null> {
    if (!this.layout.fileSystem.fileExists(uri)) {
      return null;
    }
    try {
      const raw: unknown = JSON.parse(await this.layout.fileSystem.readText(uri));
      const parsed = StoredDanceProjectSchema.safeParse(raw);
      if (!parsed.success || parsed.data.id !== expectedProjectId) {
        return null;
      }
      return parsed.data.schemaVersion === 1 ? migrateLegacyDanceProject(parsed.data) : parsed.data;
    } catch {
      return null;
    }
  }

  private async readWaveform(
    uri: string,
    expectedDurationMs: number,
  ): Promise<StoredWaveform | null> {
    if (!this.layout.fileSystem.fileExists(uri)) {
      return null;
    }
    try {
      const raw: unknown = JSON.parse(await this.layout.fileSystem.readText(uri));
      const parsed = StoredWaveformSchema.safeParse(raw);
      return parsed.success && parsed.data.durationMs === expectedDurationMs ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private removeRedundantBackup(
    backupUri: string,
    projectId: string,
    diagnostics: RecoveryDiagnostic[],
  ): void {
    if (!this.layout.fileSystem.fileExists(backupUri)) {
      return;
    }
    try {
      this.layout.fileSystem.deleteFile(backupUri);
      if (!this.layout.fileSystem.fileExists(backupUri)) {
        diagnostics.push({
          code: 'JSON_BACKUP_REMOVED',
          projectId,
          fileName: backupUri.slice(backupUri.lastIndexOf('/') + 1),
        });
      }
    } catch {
      // A valid committed file makes a leftover backup harmless.
    }
  }

  private removeFileBestEffort(uri: string): void {
    try {
      if (this.layout.fileSystem.fileExists(uri)) {
        this.layout.fileSystem.deleteFile(uri);
      }
    } catch {
      // A leftover validated transaction journal is harmless after commit.
    }
  }

  private removeStaleImportDirectories(
    diagnostics: RecoveryDiagnostic[],
    protectedImportIds: ReadonlySet<string>,
  ): string[] {
    const removedImportIds: string[] = [];

    for (const entry of this.safeListDirectory(this.layout.importsDirectoryUri)) {
      const importId = entry.name.startsWith(IMPORT_DIRECTORY_PREFIX)
        ? entry.name.slice(IMPORT_DIRECTORY_PREFIX.length)
        : '';
      if (
        entry.kind !== 'directory' ||
        !entry.name.startsWith(IMPORT_DIRECTORY_PREFIX) ||
        protectedImportIds.has(importId) ||
        !this.isStale(entry)
      ) {
        continue;
      }

      try {
        this.layout.fileSystem.deleteDirectory(entry.uri);
        if (this.layout.fileSystem.directoryExists(entry.uri)) {
          continue;
        }
      } catch {
        continue;
      }

      removedImportIds.push(importId);
      diagnostics.push({ code: 'STALE_IMPORT_REMOVED', importId });
    }

    return removedImportIds;
  }

  private async removeStaleProjectTemporaryFiles(
    diagnostics: RecoveryDiagnostic[],
  ): Promise<string[]> {
    const removedTemporaryFiles: string[] = [];

    for (const projectEntry of this.safeListDirectory(this.layout.projectsDirectoryUri)) {
      if (projectEntry.kind !== 'directory') {
        continue;
      }

      for (const entry of this.safeListDirectory(projectEntry.uri)) {
        if (entry.kind !== 'file' || !this.isStale(entry)) {
          continue;
        }

        const siblingName = this.temporarySiblingName(entry.name);
        if (siblingName === null) {
          continue;
        }

        const siblingUri = this.layout.fileSystem.join(projectEntry.uri, siblingName);
        if (!(await this.hasValidSibling(projectEntry.name, siblingName, siblingUri))) {
          continue;
        }

        try {
          this.layout.fileSystem.deleteFile(entry.uri);
          if (this.layout.fileSystem.fileExists(entry.uri)) {
            continue;
          }
        } catch {
          continue;
        }

        removedTemporaryFiles.push(entry.uri);
        diagnostics.push({
          code: 'STALE_TEMP_FILE_REMOVED',
          projectId: projectEntry.name,
          fileName: entry.name,
        });
      }
    }

    return removedTemporaryFiles;
  }

  private temporarySiblingName(fileName: string): string | null {
    if (fileName === PROJECT_METADATA_TEMP_FILE_NAME) {
      return PROJECT_METADATA_FILE_NAME;
    }
    if (fileName === PROJECT_WAVEFORM_TEMP_FILE_NAME) {
      return PROJECT_WAVEFORM_FILE_NAME;
    }
    return null;
  }

  private async hasValidSibling(
    projectId: string,
    siblingName: string,
    siblingUri: string,
  ): Promise<boolean> {
    if (!this.layout.fileSystem.fileExists(siblingUri)) {
      return false;
    }

    try {
      const raw: unknown = JSON.parse(await this.layout.fileSystem.readText(siblingUri));
      if (siblingName === PROJECT_METADATA_FILE_NAME) {
        const parsed = StoredDanceProjectSchema.safeParse(raw);
        return parsed.success && parsed.data.id === projectId;
      }
      const parsedWaveform = StoredWaveformSchema.safeParse(raw);
      if (!parsedWaveform.success) {
        return false;
      }

      const project = await this.readProject(this.layout.projectMetadataUri(projectId), projectId);
      return project !== null && parsedWaveform.data.durationMs === project.durationMs;
    } catch {
      return false;
    }
  }

  private isStale(entry: StorageEntry): boolean {
    return (
      entry.lastModifiedMs !== null && entry.lastModifiedMs < this.now() - this.transientMaxAgeMs
    );
  }

  private safeListDirectory(uri: string): readonly StorageEntry[] {
    try {
      return this.layout.fileSystem.listDirectory(uri);
    } catch {
      return [];
    }
  }
}

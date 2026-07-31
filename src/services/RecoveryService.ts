import type { ProjectIndexFile } from '@/domain/project';
import { ProjectIndexFileSchema, WaveformFileSchema } from '@/domain/validation';
import { isFileUriWithinDirectory } from '@/utils/file';

import { PickedSourceMarkerSchema, type PickedSourceMarkerFile } from './PickedSourceMarker';
import {
  PICKED_SOURCE_MARKER_FILE_NAME,
  PROJECT_AUDIO_FILE_NAME,
  PROJECT_WAVEFORM_FILE_NAME,
  type StorageEntry,
  StorageLayout,
  storageLayout,
} from './StorageLayout';

export const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type RecoveryDiagnostic =
  | {
      readonly code: 'STALE_STAGING_REMOVED';
      readonly taskId: string;
    }
  | {
      readonly code: 'MISSING_PROJECT_AUDIO';
      readonly projectId: string;
    }
  | {
      readonly code: 'UNINDEXED_PROJECT_FILES';
      readonly projectId: string;
    }
  | {
      readonly code: 'ABANDONED_PICKED_SELECTION_REMOVED';
      readonly selectionId: string;
    };

export interface TransientCacheRecoveryReport {
  readonly removedPickedSelectionIds: readonly string[];
  readonly diagnostics: readonly RecoveryDiagnostic[];
}

export interface RecoveryReport {
  readonly index: ProjectIndexFile;
  readonly removedStagingTaskIds: readonly string[];
  readonly removedPickedSelectionIds: readonly string[];
  readonly removedProjectIds: readonly string[];
  readonly orphanProjectIds: readonly string[];
  readonly diagnostics: readonly RecoveryDiagnostic[];
}

export interface RecoveryServiceOptions {
  readonly now?: () => number;
  readonly stagingMaxAgeMs?: number;
  readonly onDiagnostic?: (diagnostic: RecoveryDiagnostic) => void;
}

export class RecoveryService {
  private readonly now: () => number;
  private readonly stagingMaxAgeMs: number;
  private readonly onDiagnostic?: (diagnostic: RecoveryDiagnostic) => void;

  constructor(
    private readonly layout: StorageLayout = storageLayout,
    options: RecoveryServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.stagingMaxAgeMs = options.stagingMaxAgeMs ?? STAGING_MAX_AGE_MS;
    this.onDiagnostic = options.onDiagnostic;
  }

  async recoverTransientCache(): Promise<TransientCacheRecoveryReport> {
    const diagnostics: RecoveryDiagnostic[] = [];
    const removedPickedSelectionIds: string[] = [];
    let entries: readonly StorageEntry[];

    try {
      entries = this.layout.fileSystem.listDirectory(this.layout.pickedDirectoryUri);
    } catch {
      return {
        removedPickedSelectionIds,
        diagnostics,
      };
    }

    for (const entry of entries) {
      let entryWasRemoved = false;
      if (entry.kind === 'directory') {
        const pickerSourceWasHandled = await this.removeMarkedPickerSource(entry.uri);
        if (!pickerSourceWasHandled) {
          continue;
        }

        try {
          this.layout.fileSystem.deleteDirectory(entry.uri);
          entryWasRemoved = !this.layout.fileSystem.directoryExists(entry.uri);
        } catch {
          // A locked owned directory is retained for the next launch.
        }
      } else {
        try {
          this.layout.fileSystem.deleteFile(entry.uri);
          entryWasRemoved = !this.layout.fileSystem.fileExists(entry.uri);
        } catch {
          // A locked stray file is retained for the next launch.
        }
      }

      if (!entryWasRemoved) {
        continue;
      }

      removedPickedSelectionIds.push(entry.name);
      diagnostics.push({
        code: 'ABANDONED_PICKED_SELECTION_REMOVED',
        selectionId: entry.name,
      });
    }

    diagnostics.forEach((diagnostic) => this.onDiagnostic?.(diagnostic));
    return {
      removedPickedSelectionIds,
      diagnostics,
    };
  }

  async recover(
    index: ProjectIndexFile,
    transientCacheRecovery?: TransientCacheRecoveryReport,
  ): Promise<RecoveryReport> {
    const resolvedTransientCacheRecovery =
      transientCacheRecovery ?? (await this.recoverTransientCache());
    const validatedIndex = ProjectIndexFileSchema.parse(index);
    const diagnostics: RecoveryDiagnostic[] = [...resolvedTransientCacheRecovery.diagnostics];
    const removedStagingTaskIds = this.removeStaleStaging(diagnostics);
    const { index: repairedIndex, removedProjectIds } = this.removeProjectsWithMissingAudio(
      validatedIndex,
      diagnostics,
    );
    const orphanProjectIds = await this.findValidUnindexedProjects(repairedIndex, diagnostics);

    diagnostics
      .slice(resolvedTransientCacheRecovery.diagnostics.length)
      .forEach((diagnostic) => this.onDiagnostic?.(diagnostic));

    return {
      index: repairedIndex,
      removedStagingTaskIds,
      removedPickedSelectionIds: resolvedTransientCacheRecovery.removedPickedSelectionIds,
      removedProjectIds,
      orphanProjectIds,
      diagnostics,
    };
  }

  private async removeMarkedPickerSource(pickedSelectionDirectoryUri: string): Promise<boolean> {
    const markerUri = this.layout.fileSystem.join(
      pickedSelectionDirectoryUri,
      PICKED_SOURCE_MARKER_FILE_NAME,
    );
    if (!this.layout.fileSystem.fileExists(markerUri)) {
      return true;
    }

    let marker: PickedSourceMarkerFile | null = null;
    try {
      const raw: unknown = JSON.parse(await this.layout.fileSystem.readText(markerUri));
      const result = PickedSourceMarkerSchema.safeParse(raw);
      marker = result.success ? result.data : null;
    } catch {
      // An unreadable marker never authorizes deletion outside Picked.
    }

    if (
      marker === null ||
      !isFileUriWithinDirectory(marker.pickerSourceUri, this.layout.fileSystem.cacheDirectoryUri) ||
      isFileUriWithinDirectory(marker.pickerSourceUri, this.layout.cacheRootUri)
    ) {
      return true;
    }

    try {
      this.layout.fileSystem.deleteFile(marker.pickerSourceUri);
      return true;
    } catch {
      // Keep the validated marker so a later launch can retry a locked file.
      return false;
    }
  }

  private removeStaleStaging(diagnostics: RecoveryDiagnostic[]): string[] {
    const removedTaskIds: string[] = [];
    const threshold = this.now() - this.stagingMaxAgeMs;

    for (const entry of this.layout.fileSystem.listDirectory(this.layout.stagingDirectoryUri)) {
      if (
        entry.kind !== 'directory' ||
        entry.lastModifiedMs === null ||
        entry.lastModifiedMs >= threshold
      ) {
        continue;
      }

      this.layout.fileSystem.deleteDirectory(entry.uri);
      removedTaskIds.push(entry.name);
      diagnostics.push({
        code: 'STALE_STAGING_REMOVED',
        taskId: entry.name,
      });
    }

    return removedTaskIds;
  }

  private removeProjectsWithMissingAudio(
    index: ProjectIndexFile,
    diagnostics: RecoveryDiagnostic[],
  ): { index: ProjectIndexFile; removedProjectIds: string[] } {
    const removedProjectIds: string[] = [];
    const projects = index.projects.filter((project) => {
      let audioUri: string;

      try {
        audioUri = this.layout.resolveDocumentRelativePath(project.audioRelativePath);
      } catch {
        removedProjectIds.push(project.id);
        diagnostics.push({ code: 'MISSING_PROJECT_AUDIO', projectId: project.id });
        return false;
      }

      const audioExists =
        this.layout.fileSystem.fileExists(audioUri) &&
        this.layout.fileSystem.fileSize(audioUri) > 0;

      if (!audioExists) {
        removedProjectIds.push(project.id);
        diagnostics.push({ code: 'MISSING_PROJECT_AUDIO', projectId: project.id });
      }

      return audioExists;
    });

    return {
      index: ProjectIndexFileSchema.parse({
        schemaVersion: 1,
        projects,
      }),
      removedProjectIds,
    };
  }

  private async findValidUnindexedProjects(
    index: ProjectIndexFile,
    diagnostics: RecoveryDiagnostic[],
  ): Promise<string[]> {
    const indexedProjectIds = new Set(index.projects.map((project) => project.id));
    const orphanProjectIds: string[] = [];

    for (const entry of this.layout.fileSystem.listDirectory(this.layout.projectsDirectoryUri)) {
      if (entry.kind !== 'directory' || indexedProjectIds.has(entry.name)) {
        continue;
      }

      const audioUri = this.layout.fileSystem.join(entry.uri, PROJECT_AUDIO_FILE_NAME);
      const waveformUri = this.layout.fileSystem.join(entry.uri, PROJECT_WAVEFORM_FILE_NAME);

      if (
        !this.layout.fileSystem.fileExists(audioUri) ||
        this.layout.fileSystem.fileSize(audioUri) <= 0 ||
        !(await this.isValidWaveformFile(waveformUri))
      ) {
        continue;
      }

      orphanProjectIds.push(entry.name);
      diagnostics.push({
        code: 'UNINDEXED_PROJECT_FILES',
        projectId: entry.name,
      });
    }

    return orphanProjectIds;
  }

  private async isValidWaveformFile(uri: string): Promise<boolean> {
    if (!this.layout.fileSystem.fileExists(uri)) {
      return false;
    }

    try {
      const parsed: unknown = JSON.parse(await this.layout.fileSystem.readText(uri));
      return WaveformFileSchema.safeParse(parsed).success;
    } catch {
      return false;
    }
  }
}

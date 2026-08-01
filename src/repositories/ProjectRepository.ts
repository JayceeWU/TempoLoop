import { WAVEFORM_POINT_COUNT } from '@/constants/app';
import type { PlaybackRate } from '@/domain/playback';
import type { DanceProject, StoredWaveform } from '@/domain/project';
import { createEmptySegments, type DanceSegments } from '@/domain/segment';
import {
  DanceProjectSchema,
  DanceSegmentsSchema,
  ProjectNameSchema,
  StoredWaveformSchema,
} from '@/domain/validation';
import { developmentLog } from '@/services/DevelopmentLog';
import {
  type StructuredDiagnosticsRecorder,
  structuredDevelopmentDiagnostics,
} from '@/services/StructuredDevelopmentDiagnostics';
import {
  type ProjectMediaStatus,
  type RecoveryDiagnostic,
  type RecoveryReport,
  RecoveryService,
} from '@/services/RecoveryService';
import {
  IMPORT_METADATA_FILE_NAME,
  IMPORT_METADATA_TEMP_FILE_NAME,
  ImportTransactionJournalSchema,
  PROJECT_AUDIO_FILE_NAME,
  PROJECT_METADATA_FILE_NAME,
  PROJECT_METADATA_TEMP_FILE_NAME,
  PROJECT_WAVEFORM_FILE_NAME,
  PROJECT_WAVEFORM_TEMP_FILE_NAME,
  type StorageFileSystem,
  StorageLayout,
  storageLayout,
} from '@/services/StorageLayout';
import type { ImportMediaResult, MediaInspection } from '../../modules/tempoloop-media';
import { z, type ZodType } from 'zod';

const MediaInspectionSchema: ZodType<MediaInspection> = z.strictObject({
  sourceKind: z.enum(['audio', 'video']),
  sourceSizeBytes: z.number().finite().int().positive().nullable(),
  durationMs: z.number().finite().int().positive(),
  audioMimeType: z.string().trim().min(1).startsWith('audio/').nullable(),
  sampleRate: z.number().finite().int().positive().nullable(),
  channelCount: z.number().finite().int().positive().nullable(),
});

const ImportMediaResultMetadataSchema = z.strictObject({
  audioUri: z.string().min(1),
  audioSizeBytes: z.number().finite().int().positive(),
  durationMs: z.number().finite().int().positive(),
  waveform: z.unknown(),
});

export type ProjectRepositoryErrorCode =
  | 'E_REPOSITORY_NOT_INITIALIZED'
  | 'E_PROJECT_METADATA_CORRUPT'
  | 'E_PROJECT_NOT_FOUND'
  | 'E_PROJECT_ALREADY_EXISTS'
  | 'E_INVALID_LOCAL_URI'
  | 'E_IMPORT_FILE_MISSING'
  | 'E_IMPORT_RESULT_INVALID'
  | 'E_IMPORT_WAVEFORM_INVALID'
  | 'E_ATOMIC_MOVE_UNAVAILABLE'
  | 'E_PROJECT_DELETE_FAILED';

export class ProjectRepositoryError extends Error {
  constructor(
    readonly code: ProjectRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProjectRepositoryError';
  }
}

export interface FinalizeImportInput {
  readonly projectId: string;
  readonly name: string;
  readonly sourceDisplayName: string | null;
  readonly inspection: MediaInspection;
  readonly result: ImportMediaResult;
  readonly createdAtIso?: string;
}

export interface DiscoveredProject {
  readonly project: DanceProject;
  readonly mediaStatus: ProjectMediaStatus;
}

export interface ProjectDiscoveryReport {
  readonly projects: readonly DiscoveredProject[];
  readonly corruptProjectIds: readonly string[];
  readonly diagnostics: readonly RecoveryDiagnostic[];
}

export interface ProjectRepositoryOptions {
  readonly layout?: StorageLayout;
  readonly recoveryService?: RecoveryService;
  readonly now?: () => string;
  readonly diagnostics?: Pick<
    StructuredDiagnosticsRecorder,
    'recordProjectLoadFailure' | 'recordAudioLoadFailure'
  >;
}

function sortProjects(projects: readonly DanceProject[]): DanceProject[] {
  return [...projects].sort((left, right) => {
    const updatedComparison = right.updatedAtIso.localeCompare(left.updatedAtIso);
    return updatedComparison !== 0 ? updatedComparison : right.id.localeCompare(left.id);
  });
}

function cloneProject(project: DanceProject): DanceProject {
  return DanceProjectSchema.parse(project);
}

export class ProjectRepository {
  private readonly layout: StorageLayout;
  private readonly recoveryService: RecoveryService;
  private readonly now: () => string;
  private readonly diagnostics: Pick<
    StructuredDiagnosticsRecorder,
    'recordProjectLoadFailure' | 'recordAudioLoadFailure'
  >;
  private projects: DanceProject[] = [];
  private readonly mediaStatusByProjectId = new Map<string, ProjectMediaStatus>();
  private initialized = false;
  private initializationTask: Promise<void> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private launchRecoveryReport: RecoveryReport | null = null;
  private lastRecoveryReport: RecoveryReport | null = null;

  constructor(options: ProjectRepositoryOptions = {}) {
    this.layout = options.layout ?? storageLayout;
    this.recoveryService =
      options.recoveryService ??
      new RecoveryService(this.layout, {
        onDiagnostic: (diagnostic) => {
          developmentLog.record('warn', 'repository.recovery', diagnostic);
        },
      });
    this.now = options.now ?? (() => new Date().toISOString());
    this.diagnostics = options.diagnostics ?? structuredDevelopmentDiagnostics;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializationTask === null) {
      this.initializationTask = this.initializeInternal();
    }

    try {
      await this.initializationTask;
    } finally {
      if (!this.initialized) {
        this.initializationTask = null;
      }
    }
  }

  async discover(): Promise<ProjectDiscoveryReport> {
    if (!this.initialized) {
      await this.initialize();
      return this.currentDiscoveryReport();
    }

    await this.mutationTail;
    return this.scanProjectDirectories();
  }

  list(): DanceProject[] {
    this.assertInitialized();
    return this.projects.map(cloneProject);
  }

  get(projectId: string): DanceProject | null {
    this.assertInitialized();
    const project = this.projects.find((candidate) => candidate.id === projectId);
    return project === undefined ? null : cloneProject(project);
  }

  getMediaStatus(projectId: string): ProjectMediaStatus | null {
    this.assertInitialized();
    const status = this.mediaStatusByProjectId.get(projectId);
    return status === undefined ? null : { state: status.state, issues: [...status.issues] };
  }

  getLastRecoveryReport(): RecoveryReport | null {
    return this.lastRecoveryReport;
  }

  resolveAudioUri(project: DanceProject): string {
    return this.layout.fileSystem.join(
      this.layout.projectDirectoryUri(project.id),
      project.audioFileName,
    );
  }

  resolveWaveformUri(project: DanceProject): string {
    return this.layout.fileSystem.join(
      this.layout.projectDirectoryUri(project.id),
      project.waveformFileName,
    );
  }

  createImportDirectory(projectId: string): string {
    this.assertInitialized();
    const uri = this.layout.importDirectoryUri(projectId);
    if (
      this.layout.fileSystem.directoryExists(uri) ||
      this.layout.fileSystem.directoryExists(this.layout.projectDirectoryUri(projectId))
    ) {
      throw new ProjectRepositoryError(
        'E_PROJECT_ALREADY_EXISTS',
        `A transaction or Project with ID "${projectId}" already exists.`,
      );
    }
    this.layout.fileSystem.ensureDirectory(uri);
    return uri;
  }

  removeImportDirectory(projectId: string): void {
    const uri = this.layout.importDirectoryUri(projectId);
    if (this.layout.fileSystem.directoryExists(uri)) {
      this.layout.fileSystem.deleteDirectory(uri);
    }
  }

  finalizeImport(input: FinalizeImportInput): Promise<DanceProject> {
    return this.enqueueMutation(() => this.finalizeImportWithCleanup(input));
  }

  rename(projectId: string, name: string): Promise<void> {
    const normalizedName = ProjectNameSchema.parse(name);
    return this.updateProject(projectId, (project) => ({
      ...project,
      name: normalizedName,
    }));
  }

  updateSegments(projectId: string, segments: DanceSegments): Promise<void> {
    const validatedSegments = DanceSegmentsSchema.parse(segments);
    return this.updateProject(projectId, (project) => ({
      ...project,
      segments: validatedSegments,
    }));
  }

  updateSelectedRate(projectId: string, selectedRate: PlaybackRate): Promise<void> {
    return this.updateProject(projectId, (project) => ({
      ...project,
      selectedRate,
    }));
  }

  delete(projectId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      this.getRequired(projectId);
      const projectDirectoryUri = this.layout.projectDirectoryUri(projectId);
      this.layout.fileSystem.deleteDirectory(projectDirectoryUri);
      if (this.layout.fileSystem.directoryExists(projectDirectoryUri)) {
        throw new ProjectRepositoryError(
          'E_PROJECT_DELETE_FAILED',
          `Project "${projectId}" could not be deleted.`,
        );
      }
      this.projects = this.projects.filter((project) => project.id !== projectId);
      this.mediaStatusByProjectId.delete(projectId);
    });
  }

  private async initializeInternal(): Promise<void> {
    this.layout.ensureBaseDirectories();
    this.launchRecoveryReport = await this.recoveryService.recover();
    await this.scanProjectDirectories();
    this.initialized = true;
  }

  private async scanProjectDirectories(): Promise<ProjectDiscoveryReport> {
    const discovered: DiscoveredProject[] = [];
    const corruptProjectIds: string[] = [];
    const discoveryDiagnostics: RecoveryDiagnostic[] = [];

    for (const entry of this.layout.fileSystem.listDirectory(this.layout.projectsDirectoryUri)) {
      if (entry.kind !== 'directory') {
        continue;
      }

      const metadataUri = this.layout.fileSystem.join(entry.uri, PROJECT_METADATA_FILE_NAME);
      let project: DanceProject | null = null;
      try {
        const raw: unknown = JSON.parse(await this.layout.fileSystem.readText(metadataUri));
        const parsed = DanceProjectSchema.safeParse(raw);
        project = parsed.success && parsed.data.id === entry.name ? parsed.data : null;
      } catch {
        project = null;
      }

      if (project === null) {
        corruptProjectIds.push(entry.name);
        this.diagnostics.recordProjectLoadFailure({
          projectId: entry.name,
          error: { code: 'E_PROJECT_CORRUPT' },
        });
        discoveryDiagnostics.push({
          code: 'CORRUPT_PROJECT_METADATA',
          projectId: entry.name,
        });
        continue;
      }

      const mediaStatus = await this.recoveryService.inspectProjectMedia(project);
      discovered.push({ project, mediaStatus });
      if (mediaStatus.state === 'needs-repair') {
        if (mediaStatus.issues.includes('AUDIO_MISSING_OR_EMPTY')) {
          this.diagnostics.recordAudioLoadFailure({
            projectId: project.id,
            error: { code: 'E_AUDIO_NOT_FOUND' },
          });
        }
        discoveryDiagnostics.push({
          code: 'PROJECT_NEEDS_REPAIR',
          projectId: project.id,
          issues: mediaStatus.issues,
        });
      }
    }

    discovered.sort((left, right) => {
      const updatedComparison = right.project.updatedAtIso.localeCompare(left.project.updatedAtIso);
      return updatedComparison !== 0
        ? updatedComparison
        : right.project.id.localeCompare(left.project.id);
    });

    this.projects = sortProjects(discovered.map(({ project }) => project));
    this.mediaStatusByProjectId.clear();
    discovered.forEach(({ project, mediaStatus }) => {
      this.mediaStatusByProjectId.set(project.id, mediaStatus);
    });

    const launchReport = this.launchRecoveryReport ?? {
      removedImportIds: [],
      removedTemporaryFiles: [],
      corruptProjectIds: [],
      repairProjectIds: [],
      diagnostics: [],
    };
    const repairProjectIds = discovered
      .filter(({ mediaStatus }) => mediaStatus.state === 'needs-repair')
      .map(({ project }) => project.id);
    this.lastRecoveryReport = {
      ...launchReport,
      corruptProjectIds,
      repairProjectIds,
      diagnostics: [...launchReport.diagnostics, ...discoveryDiagnostics],
    };

    discoveryDiagnostics.forEach((diagnostic) => {
      developmentLog.record('warn', 'repository.discovery', diagnostic);
    });

    return {
      projects: discovered.map(({ project, mediaStatus }) => ({
        project: cloneProject(project),
        mediaStatus: { state: mediaStatus.state, issues: [...mediaStatus.issues] },
      })),
      corruptProjectIds,
      diagnostics: discoveryDiagnostics,
    };
  }

  private currentDiscoveryReport(): ProjectDiscoveryReport {
    return {
      projects: this.projects.map((project) => ({
        project: cloneProject(project),
        mediaStatus: this.getMediaStatus(project.id) ?? {
          state: 'needs-repair',
          issues: ['AUDIO_MISSING_OR_EMPTY'],
        },
      })),
      corruptProjectIds: [...(this.lastRecoveryReport?.corruptProjectIds ?? [])],
      diagnostics:
        this.lastRecoveryReport?.diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === 'CORRUPT_PROJECT_METADATA' ||
            diagnostic.code === 'PROJECT_NEEDS_REPAIR',
        ) ?? [],
    };
  }

  private async finalizeImportWithCleanup(input: FinalizeImportInput): Promise<DanceProject> {
    let finalDirectoryExistedBefore = false;
    try {
      finalDirectoryExistedBefore = this.layout.fileSystem.directoryExists(
        this.layout.projectDirectoryUri(input.projectId),
      );
      return await this.finalizeImportInternal(input);
    } catch (error) {
      try {
        const importDirectoryUri = this.layout.importDirectoryUri(input.projectId);
        const finalDirectoryUri = this.layout.projectDirectoryUri(input.projectId);
        if (
          finalDirectoryExistedBefore ||
          !this.layout.fileSystem.directoryExists(finalDirectoryUri)
        ) {
          this.tryRemoveImportDirectory(importDirectoryUri);
        }
      } catch {
        // An invalid project ID cannot authorize any cleanup path.
      }
      throw error;
    }
  }

  private async finalizeImportInternal(input: FinalizeImportInput): Promise<DanceProject> {
    if (this.projects.some((project) => project.id === input.projectId)) {
      throw new ProjectRepositoryError(
        'E_PROJECT_ALREADY_EXISTS',
        `A project with ID "${input.projectId}" already exists.`,
      );
    }

    const finalDirectoryUri = this.layout.projectDirectoryUri(input.projectId);
    if (this.layout.fileSystem.directoryExists(finalDirectoryUri)) {
      throw new ProjectRepositoryError(
        'E_PROJECT_ALREADY_EXISTS',
        `A project directory with ID "${input.projectId}" already exists.`,
      );
    }

    const importDirectoryUri = this.layout.importDirectoryUri(input.projectId);
    const partialAudioUri = this.layout.importPartialAudioUri(input.projectId);
    this.assertImportDirectory(importDirectoryUri);

    const inspectionResult = MediaInspectionSchema.safeParse(input.inspection);
    const mediaResult = ImportMediaResultMetadataSchema.safeParse(input.result);
    if (!inspectionResult.success || !mediaResult.success) {
      throw new ProjectRepositoryError(
        'E_IMPORT_RESULT_INVALID',
        'The native import metadata is invalid.',
      );
    }

    if (mediaResult.data.audioUri !== partialAudioUri) {
      throw new ProjectRepositoryError(
        'E_INVALID_LOCAL_URI',
        'The native audio result does not match this Project import transaction.',
      );
    }

    this.assertImportFile(partialAudioUri, 'audio');
    if (this.layout.fileSystem.fileSize(partialAudioUri) !== mediaResult.data.audioSizeBytes) {
      throw new ProjectRepositoryError(
        'E_IMPORT_RESULT_INVALID',
        'The native audio size does not match the exported file.',
      );
    }

    let waveform: StoredWaveform;
    try {
      waveform = StoredWaveformSchema.parse({
        schemaVersion: 1,
        durationMs: mediaResult.data.durationMs,
        sampleCount: WAVEFORM_POINT_COUNT,
        samples: input.result.waveform,
      });
    } catch (error) {
      throw new ProjectRepositoryError(
        'E_IMPORT_WAVEFORM_INVALID',
        'The imported waveform is invalid.',
        { cause: error },
      );
    }

    const timestamp = input.createdAtIso ?? this.now();
    const project = DanceProjectSchema.parse({
      schemaVersion: 1,
      id: input.projectId,
      name: ProjectNameSchema.parse(input.name),
      createdAtIso: timestamp,
      updatedAtIso: timestamp,
      audioFileName: PROJECT_AUDIO_FILE_NAME,
      waveformFileName: PROJECT_WAVEFORM_FILE_NAME,
      durationMs: mediaResult.data.durationMs,
      sourceDisplayName: input.sourceDisplayName,
      sourceSizeBytes: inspectionResult.data.sourceSizeBytes,
      selectedRate: 1,
      segments: createEmptySegments(),
    });

    const moveDirectory = this.layout.fileSystem.moveDirectory;
    if (moveDirectory === undefined) {
      throw new ProjectRepositoryError(
        'E_ATOMIC_MOVE_UNAVAILABLE',
        'This filesystem cannot atomically finalize an imported project.',
      );
    }

    try {
      const finalAudioUri = this.layout.fileSystem.join(
        importDirectoryUri,
        PROJECT_AUDIO_FILE_NAME,
      );
      await this.writeValidatedJson(
        this.layout.fileSystem.join(importDirectoryUri, PROJECT_WAVEFORM_TEMP_FILE_NAME),
        this.layout.fileSystem.join(importDirectoryUri, PROJECT_WAVEFORM_FILE_NAME),
        waveform,
        StoredWaveformSchema,
        'waveform',
      );
      await this.writeValidatedTemporaryJson(
        this.layout.fileSystem.join(importDirectoryUri, PROJECT_METADATA_TEMP_FILE_NAME),
        project,
        DanceProjectSchema,
        'project metadata',
      );

      const journal = ImportTransactionJournalSchema.parse({
        schemaVersion: 1,
        projectId: project.id,
        expectedAudioSizeBytes: mediaResult.data.audioSizeBytes,
        durationMs: project.durationMs,
      });
      await this.writeValidatedJson(
        this.layout.fileSystem.join(importDirectoryUri, IMPORT_METADATA_TEMP_FILE_NAME),
        this.layout.fileSystem.join(importDirectoryUri, IMPORT_METADATA_FILE_NAME),
        journal,
        ImportTransactionJournalSchema,
        'import transaction journal',
      );

      let audioMoveError: unknown = null;
      try {
        await this.layout.fileSystem.moveFile(partialAudioUri, finalAudioUri);
      } catch (error) {
        audioMoveError = error;
      }
      const audioMoveCompleted =
        !this.layout.fileSystem.fileExists(partialAudioUri) &&
        this.layout.fileSystem.fileExists(finalAudioUri) &&
        this.layout.fileSystem.fileSize(finalAudioUri) === mediaResult.data.audioSizeBytes;
      if (!audioMoveCompleted) {
        if (audioMoveError !== null) {
          throw audioMoveError;
        }
        throw new ProjectRepositoryError(
          'E_IMPORT_FILE_MISSING',
          'The exported partial audio could not be finalized.',
        );
      }

      let recoveredCompletedMove = false;
      try {
        await moveDirectory.call(this.layout.fileSystem, importDirectoryUri, finalDirectoryUri);
      } catch (moveError) {
        try {
          await this.validateMovedImportDirectory(finalDirectoryUri, importDirectoryUri, project);
          recoveredCompletedMove = true;
        } catch {
          throw moveError;
        }
      }

      if (!recoveredCompletedMove) {
        await this.validateMovedImportDirectory(finalDirectoryUri, importDirectoryUri, project);
      }
      await this.promoteValidatedTemporaryJson(
        this.layout.fileSystem.join(finalDirectoryUri, PROJECT_METADATA_TEMP_FILE_NAME),
        this.layout.fileSystem.join(finalDirectoryUri, PROJECT_METADATA_FILE_NAME),
        DanceProjectSchema,
        'project metadata',
      );
      this.deleteFileBestEffort(
        this.layout.fileSystem.join(finalDirectoryUri, IMPORT_METADATA_FILE_NAME),
      );
    } catch (error) {
      let finalTargetAbsent = !this.layout.fileSystem.directoryExists(finalDirectoryUri);
      if (this.layout.fileSystem.directoryExists(finalDirectoryUri)) {
        const committedProject = await this.readValidatedJson(
          this.layout.fileSystem.join(finalDirectoryUri, PROJECT_METADATA_FILE_NAME),
          DanceProjectSchema,
        );
        if (
          committedProject === null ||
          JSON.stringify(committedProject) !== JSON.stringify(project)
        ) {
          try {
            this.layout.fileSystem.deleteDirectory(finalDirectoryUri);
          } catch {
            // Preserve the import source when an uncommitted target cannot be removed.
          }
          finalTargetAbsent = !this.layout.fileSystem.directoryExists(finalDirectoryUri);
        }
      }
      if (finalTargetAbsent && this.layout.fileSystem.directoryExists(importDirectoryUri)) {
        try {
          this.layout.fileSystem.deleteDirectory(importDirectoryUri);
        } catch {
          // Recovery will retry this app-owned import after the grace period.
        }
      }
      throw error;
    }

    this.projects = sortProjects([...this.projects, project]);
    this.mediaStatusByProjectId.set(project.id, { state: 'ready', issues: [] });
    return cloneProject(project);
  }

  private updateProject(
    projectId: string,
    transform: (project: DanceProject) => DanceProject,
  ): Promise<void> {
    return this.enqueueMutation(async () => {
      const currentProject = this.getRequired(projectId);
      const updatedProject = DanceProjectSchema.parse({
        ...transform(currentProject),
        updatedAtIso: this.now(),
      });

      await this.writeValidatedJson(
        this.layout.projectMetadataTempUri(projectId),
        this.layout.projectMetadataUri(projectId),
        updatedProject,
        DanceProjectSchema,
        'project metadata',
      );
      this.projects = sortProjects(
        this.projects.map((project) => (project.id === projectId ? updatedProject : project)),
      );
    });
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertInitialized();
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async writeValidatedJson<T>(
    temporaryUri: string,
    destinationUri: string,
    value: T,
    schema: ZodType<T>,
    label: string,
  ): Promise<T> {
    await this.writeValidatedTemporaryJson(temporaryUri, value, schema, label);
    const backupUri = `${destinationUri}.bak`;
    let hasVerifiedBackup = false;

    if (this.layout.fileSystem.fileExists(destinationUri)) {
      const current = await this.readValidatedJson(destinationUri, schema);
      if (current === null) {
        throw new ProjectRepositoryError(
          'E_PROJECT_METADATA_CORRUPT',
          `The existing ${label} is invalid and cannot be replaced safely.`,
        );
      }

      await this.layout.fileSystem.copyFile(destinationUri, backupUri);
      hasVerifiedBackup = (await this.readValidatedJson(backupUri, schema)) !== null;
      if (!hasVerifiedBackup) {
        throw new ProjectRepositoryError(
          'E_PROJECT_METADATA_CORRUPT',
          `The ${label} backup failed validation.`,
        );
      }
    }

    try {
      const committed = await this.promoteValidatedTemporaryJson(
        temporaryUri,
        destinationUri,
        schema,
        label,
      );
      this.deleteFileBestEffort(backupUri);
      return committed;
    } catch (error) {
      if (hasVerifiedBackup) {
        await this.restoreValidatedBackup(backupUri, destinationUri, schema);
      }
      throw error;
    }
  }

  private async writeValidatedTemporaryJson<T>(
    temporaryUri: string,
    value: T,
    schema: ZodType<T>,
    label: string,
  ): Promise<T> {
    const validated = schema.parse(value);
    this.layout.fileSystem.writeText(temporaryUri, JSON.stringify(validated, null, 2));

    const temporary = await this.readValidatedJson(temporaryUri, schema);
    if (temporary === null) {
      throw new ProjectRepositoryError(
        'E_PROJECT_METADATA_CORRUPT',
        `The temporary ${label} failed validation after it was written.`,
      );
    }
    return temporary;
  }

  private async promoteValidatedTemporaryJson<T>(
    temporaryUri: string,
    destinationUri: string,
    schema: ZodType<T>,
    label: string,
  ): Promise<T> {
    const intended = await this.readValidatedJson(temporaryUri, schema);
    if (intended === null) {
      throw new ProjectRepositoryError(
        'E_PROJECT_METADATA_CORRUPT',
        `The temporary ${label} is missing or invalid before commit.`,
      );
    }

    let moveError: unknown = null;
    try {
      await this.layout.fileSystem.moveFile(temporaryUri, destinationUri);
    } catch (error) {
      moveError = error;
    }

    const committed = await this.readValidatedJson(destinationUri, schema);
    if (committed !== null && JSON.stringify(committed) === JSON.stringify(intended)) {
      return committed;
    }
    if (moveError !== null) {
      throw moveError;
    }
    if (committed === null) {
      throw new ProjectRepositoryError(
        'E_PROJECT_METADATA_CORRUPT',
        `The committed ${label} failed validation.`,
      );
    }
    throw new ProjectRepositoryError(
      'E_PROJECT_METADATA_CORRUPT',
      `The committed ${label} does not match the intended value.`,
    );
  }

  private async restoreValidatedBackup<T>(
    backupUri: string,
    destinationUri: string,
    schema: ZodType<T>,
  ): Promise<boolean> {
    if ((await this.readValidatedJson(backupUri, schema)) === null) {
      return false;
    }

    try {
      await this.layout.fileSystem.copyFile(backupUri, destinationUri);
      if ((await this.readValidatedJson(destinationUri, schema)) === null) {
        return false;
      }
      this.deleteFileBestEffort(backupUri);
      return true;
    } catch {
      return false;
    }
  }

  private deleteFileBestEffort(uri: string): void {
    try {
      if (this.layout.fileSystem.fileExists(uri)) {
        this.layout.fileSystem.deleteFile(uri);
      }
    } catch {
      // A verified destination makes a leftover backup safe for launch recovery.
    }
  }

  private async validateMovedImportDirectory(
    directoryUri: string,
    sourceImportDirectoryUri: string,
    expectedProject: DanceProject,
  ): Promise<void> {
    if (!this.layout.fileSystem.directoryExists(directoryUri)) {
      throw new ProjectRepositoryError(
        'E_IMPORT_FILE_MISSING',
        'The finalized project directory is missing.',
      );
    }
    if (this.layout.fileSystem.directoryExists(sourceImportDirectoryUri)) {
      throw new ProjectRepositoryError(
        'E_IMPORT_FILE_MISSING',
        'The source import directory still exists after finalization.',
      );
    }

    const journalUri = this.layout.fileSystem.join(directoryUri, IMPORT_METADATA_FILE_NAME);
    const journal = await this.readValidatedJson(journalUri, ImportTransactionJournalSchema);
    if (
      journal === null ||
      journal.projectId !== expectedProject.id ||
      journal.durationMs !== expectedProject.durationMs
    ) {
      throw new ProjectRepositoryError(
        'E_PROJECT_METADATA_CORRUPT',
        'The finalized import transaction journal is invalid.',
      );
    }

    const audioUri = this.layout.fileSystem.join(directoryUri, PROJECT_AUDIO_FILE_NAME);
    if (
      !this.layout.fileSystem.fileExists(audioUri) ||
      this.layout.fileSystem.fileSize(audioUri) !== journal.expectedAudioSizeBytes
    ) {
      throw new ProjectRepositoryError(
        'E_IMPORT_FILE_MISSING',
        'The finalized project audio size does not match the import journal.',
      );
    }

    const waveformUri = this.layout.fileSystem.join(directoryUri, PROJECT_WAVEFORM_FILE_NAME);
    const waveform = await this.readValidatedJson(waveformUri, StoredWaveformSchema);
    if (waveform === null || waveform.durationMs !== expectedProject.durationMs) {
      throw new ProjectRepositoryError(
        'E_IMPORT_WAVEFORM_INVALID',
        'The finalized project waveform is invalid.',
      );
    }

    const metadataTempUri = this.layout.fileSystem.join(
      directoryUri,
      PROJECT_METADATA_TEMP_FILE_NAME,
    );
    const metadata = await this.readValidatedJson(metadataTempUri, DanceProjectSchema);
    if (metadata === null || JSON.stringify(metadata) !== JSON.stringify(expectedProject)) {
      throw new ProjectRepositoryError(
        'E_PROJECT_METADATA_CORRUPT',
        'The finalized temporary project metadata is invalid.',
      );
    }
  }

  private async readValidatedJson<T>(uri: string, schema: ZodType<T>): Promise<T | null> {
    if (!this.layout.fileSystem.fileExists(uri)) {
      return null;
    }
    try {
      const raw: unknown = JSON.parse(await this.layout.fileSystem.readText(uri));
      const parsed = schema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private getRequired(projectId: string): DanceProject {
    const project = this.get(projectId);
    if (project === null) {
      throw new ProjectRepositoryError(
        'E_PROJECT_NOT_FOUND',
        `Project "${projectId}" was not found.`,
      );
    }
    return project;
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new ProjectRepositoryError(
        'E_REPOSITORY_NOT_INITIALIZED',
        'ProjectRepository.initialize() must finish before repository access.',
      );
    }
  }

  private assertImportDirectory(uri: string): void {
    if (!uri.startsWith('file://') || !this.layout.isImportDirectoryUri(uri)) {
      throw new ProjectRepositoryError(
        'E_INVALID_LOCAL_URI',
        'Imported files must stay inside the TempoLoop imports directory.',
      );
    }
    if (!this.layout.fileSystem.directoryExists(uri)) {
      throw new ProjectRepositoryError(
        'E_IMPORT_FILE_MISSING',
        'The temporary import directory is missing.',
      );
    }
  }

  private assertImportFile(uri: string, kind: 'audio' | 'waveform'): void {
    if (
      !uri.startsWith('file://') ||
      !this.layout.isUriInsideImports(uri) ||
      !this.layout.fileSystem.fileExists(uri) ||
      this.layout.fileSystem.fileSize(uri) <= 0
    ) {
      throw new ProjectRepositoryError(
        'E_IMPORT_FILE_MISSING',
        `The temporary ${kind} file is missing or empty.`,
      );
    }
  }

  private tryRemoveImportDirectory(uri: string): void {
    if (!this.layout.isImportDirectoryUri(uri)) {
      return;
    }
    try {
      if (this.layout.fileSystem.directoryExists(uri)) {
        this.layout.fileSystem.deleteDirectory(uri);
      }
    } catch {
      // Recovery retries this app-owned directory after the one-hour grace period.
    }
  }
}

export const projectRepository = new ProjectRepository();

export type { StorageFileSystem };

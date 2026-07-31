import type { PlaybackRate } from '@/domain/playback';
import type { DanceProject, ProjectIndexFile } from '@/domain/project';
import { createEmptySegments, type DanceSegments, type SegmentNumber } from '@/domain/segment';
import {
  DanceSegmentsSchema,
  ProjectIndexFileSchema,
  WaveformFileSchema,
  normalizeProjectName,
} from '@/domain/validation';
import { developmentLog } from '@/services/DevelopmentLog';
import { type RecoveryReport, RecoveryService } from '@/services/RecoveryService';
import { type StorageFileSystem, StorageLayout, storageLayout } from '@/services/StorageLayout';

export type ProjectRepositoryErrorCode =
  | 'E_REPOSITORY_NOT_INITIALIZED'
  | 'E_PROJECT_INDEX_CORRUPT'
  | 'E_PROJECT_NOT_FOUND'
  | 'E_PROJECT_ALREADY_EXISTS'
  | 'E_INVALID_LOCAL_URI'
  | 'E_IMPORT_FILE_MISSING'
  | 'E_IMPORT_WAVEFORM_INVALID';

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

export interface CreateProjectInput {
  readonly id: string;
  readonly name: string;
  readonly durationMs: number;
  readonly sourceVideoBytes: number;
  readonly stagedAudioUri: string;
  readonly stagedWaveformUri: string;
  readonly createdAtIso?: string;
}

export interface ProjectRepositoryOptions {
  readonly layout?: StorageLayout;
  readonly recoveryService?: RecoveryService;
  readonly now?: () => string;
}

const EMPTY_INDEX: ProjectIndexFile = {
  schemaVersion: 1,
  projects: [],
};

function sortProjects(projects: readonly DanceProject[]): DanceProject[] {
  return [...projects].sort((left, right) => {
    const updatedComparison = right.updatedAtIso.localeCompare(left.updatedAtIso);
    return updatedComparison !== 0 ? updatedComparison : right.id.localeCompare(left.id);
  });
}

export class ProjectRepository {
  private readonly layout: StorageLayout;
  private readonly recoveryService: RecoveryService;
  private readonly now: () => string;
  private index: ProjectIndexFile = EMPTY_INDEX;
  private initialized = false;
  private initializationTask: Promise<void> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
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

  list(): DanceProject[] {
    this.assertInitialized();
    return ProjectIndexFileSchema.parse({
      schemaVersion: 1,
      projects: sortProjects(this.index.projects),
    }).projects;
  }

  get(projectId: string): DanceProject | null {
    this.assertInitialized();
    const project = this.index.projects.find((candidate) => candidate.id === projectId);
    if (project === undefined) {
      return null;
    }

    return (
      ProjectIndexFileSchema.parse({
        schemaVersion: 1,
        projects: [project],
      }).projects[0] ?? null
    );
  }

  getLastRecoveryReport(): RecoveryReport | null {
    return this.lastRecoveryReport;
  }

  resolveAudioUri(project: DanceProject): string {
    return this.layout.resolveDocumentRelativePath(project.audioRelativePath);
  }

  resolveWaveformUri(project: DanceProject): string {
    return this.layout.resolveDocumentRelativePath(project.waveformRelativePath);
  }

  createFromImportedFiles(input: CreateProjectInput): Promise<DanceProject> {
    return this.enqueueMutation(async () => {
      this.assertLocalStagingUri(input.stagedAudioUri);
      this.assertLocalStagingUri(input.stagedWaveformUri);
      this.assertImportedFileExists(input.stagedAudioUri, 'audio');
      this.assertImportedFileExists(input.stagedWaveformUri, 'waveform');
      await this.assertValidWaveform(input.stagedWaveformUri, input.durationMs);

      if (this.index.projects.some((project) => project.id === input.id)) {
        throw new ProjectRepositoryError(
          'E_PROJECT_ALREADY_EXISTS',
          `A project with ID "${input.id}" already exists.`,
        );
      }

      const finalDirectoryUri = this.layout.projectDirectoryUri(input.id);
      if (this.layout.fileSystem.directoryExists(finalDirectoryUri)) {
        throw new ProjectRepositoryError(
          'E_PROJECT_ALREADY_EXISTS',
          `A project directory with ID "${input.id}" already exists.`,
        );
      }

      const timestamp = input.createdAtIso ?? this.now();
      const project: DanceProject = {
        schemaVersion: 1,
        id: input.id,
        name: normalizeProjectName(input.name),
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        durationMs: input.durationMs,
        sourceVideoBytes: input.sourceVideoBytes,
        audioRelativePath: this.layout.projectAudioRelativePath(input.id),
        waveformRelativePath: this.layout.projectWaveformRelativePath(input.id),
        preferredRate: 1,
        lastSelectedSegment: null,
        segments: createEmptySegments(),
      };

      const nextIndex = this.validateAndSortIndex({
        schemaVersion: 1,
        projects: [...this.index.projects, project],
      });

      let createdFinalDirectory = false;
      try {
        this.layout.fileSystem.ensureDirectory(finalDirectoryUri);
        createdFinalDirectory = true;
        await this.layout.fileSystem.moveFile(
          input.stagedAudioUri,
          this.layout.projectAudioUri(input.id),
        );
        await this.layout.fileSystem.moveFile(
          input.stagedWaveformUri,
          this.layout.projectWaveformUri(input.id),
        );
        await this.persistIndex(nextIndex);
      } catch (error) {
        if (createdFinalDirectory) {
          this.layout.fileSystem.deleteDirectory(finalDirectoryUri);
        }
        throw error;
      }

      return this.getRequired(project.id);
    });
  }

  rename(projectId: string, name: string): Promise<void> {
    const normalizedName = normalizeProjectName(name);
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

  updatePreferences(
    projectId: string,
    preferredRate: PlaybackRate,
    lastSelectedSegment: SegmentNumber | null,
  ): Promise<void> {
    return this.updateProject(projectId, (project) => ({
      ...project,
      preferredRate,
      lastSelectedSegment,
    }));
  }

  delete(projectId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      this.getRequired(projectId);
      const nextIndex = this.validateAndSortIndex({
        schemaVersion: 1,
        projects: this.index.projects.filter((project) => project.id !== projectId),
      });

      // Delete user media first. If the metadata write then fails, launch recovery
      // will remove the now-unplayable entry instead of retaining private media.
      this.layout.fileSystem.deleteDirectory(this.layout.projectDirectoryUri(projectId));
      await this.persistIndex(nextIndex);
    });
  }

  private async initializeInternal(): Promise<void> {
    this.layout.ensureBaseDirectories();
    const transientCacheRecovery = await this.recoveryService.recoverTransientCache();
    const loadedIndex = await this.loadBestAvailableIndex();
    const recoveryReport = await this.recoveryService.recover(loadedIndex, transientCacheRecovery);

    if (recoveryReport.removedProjectIds.length > 0) {
      await this.persistIndex(recoveryReport.index);
    } else {
      this.index = this.validateAndSortIndex(recoveryReport.index);
    }

    this.lastRecoveryReport = recoveryReport;
    this.initialized = true;
  }

  private async loadBestAvailableIndex(): Promise<ProjectIndexFile> {
    const fileSystem = this.layout.fileSystem;
    const primary = await this.tryReadIndex(this.layout.projectIndexUri);

    if (primary !== null) {
      fileSystem.deleteFile(this.layout.projectIndexTempUri);
      return primary;
    }

    const backup = await this.tryReadIndex(this.layout.projectIndexBackupUri);
    if (backup !== null) {
      const restored = await this.writeIndexAtomically(backup);
      return restored;
    }

    const temporary = await this.tryReadIndex(this.layout.projectIndexTempUri);
    if (temporary !== null) {
      const restored = await this.writeIndexAtomically(temporary);
      return restored;
    }

    const anyMetadataFileExists =
      fileSystem.fileExists(this.layout.projectIndexUri) ||
      fileSystem.fileExists(this.layout.projectIndexBackupUri) ||
      fileSystem.fileExists(this.layout.projectIndexTempUri);

    if (anyMetadataFileExists) {
      throw new ProjectRepositoryError(
        'E_PROJECT_INDEX_CORRUPT',
        'The project index and its recovery copies are invalid.',
      );
    }

    return this.writeIndexAtomically(EMPTY_INDEX);
  }

  private updateProject(
    projectId: string,
    transform: (project: DanceProject) => DanceProject,
  ): Promise<void> {
    return this.enqueueMutation(async () => {
      const currentProject = this.getRequired(projectId);
      const updatedProject = {
        ...transform(currentProject),
        updatedAtIso: this.now(),
      };
      const nextIndex = this.validateAndSortIndex({
        schemaVersion: 1,
        projects: this.index.projects.map((project) =>
          project.id === projectId ? updatedProject : project,
        ),
      });
      await this.persistIndex(nextIndex);
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

  private async persistIndex(index: ProjectIndexFile): Promise<void> {
    const persisted = await this.writeIndexAtomically(index);
    this.index = persisted;
  }

  private async writeIndexAtomically(index: ProjectIndexFile): Promise<ProjectIndexFile> {
    const fileSystem = this.layout.fileSystem;
    const validatedIndex = this.validateAndSortIndex(index);
    const serialized = JSON.stringify(validatedIndex, null, 2);

    fileSystem.writeText(this.layout.projectIndexTempUri, serialized);

    const temporaryIndex = await this.tryReadIndex(this.layout.projectIndexTempUri);
    if (temporaryIndex === null) {
      throw new ProjectRepositoryError(
        'E_PROJECT_INDEX_CORRUPT',
        'The temporary project index failed validation after it was written.',
      );
    }

    const currentPrimary = await this.tryReadIndex(this.layout.projectIndexUri);
    if (currentPrimary !== null) {
      await fileSystem.copyFile(this.layout.projectIndexUri, this.layout.projectIndexBackupUri);
    }

    await fileSystem.moveFile(this.layout.projectIndexTempUri, this.layout.projectIndexUri);

    const committed = await this.tryReadIndex(this.layout.projectIndexUri);
    if (committed === null) {
      throw new ProjectRepositoryError(
        'E_PROJECT_INDEX_CORRUPT',
        'The committed project index failed validation.',
      );
    }

    return this.validateAndSortIndex(committed);
  }

  private async tryReadIndex(uri: string): Promise<ProjectIndexFile | null> {
    if (!this.layout.fileSystem.fileExists(uri)) {
      return null;
    }

    try {
      const raw: unknown = JSON.parse(await this.layout.fileSystem.readText(uri));
      return this.validateAndSortIndex(raw);
    } catch {
      return null;
    }
  }

  private validateAndSortIndex(value: unknown): ProjectIndexFile {
    const parsed = ProjectIndexFileSchema.parse(value);
    return ProjectIndexFileSchema.parse({
      schemaVersion: 1,
      projects: sortProjects(parsed.projects),
    });
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

  private assertLocalStagingUri(uri: string): void {
    if (!uri.startsWith('file://')) {
      throw new ProjectRepositoryError(
        'E_INVALID_LOCAL_URI',
        'Imported files must use local file:// URIs.',
      );
    }

    const stagingPrefix = `${this.layout.stagingDirectoryUri.replace(/\/+$/, '')}/`;
    if (!uri.startsWith(stagingPrefix)) {
      throw new ProjectRepositoryError(
        'E_INVALID_LOCAL_URI',
        'Imported files must come from the TempoLoop staging directory.',
      );
    }
  }

  private assertImportedFileExists(uri: string, kind: 'audio' | 'waveform'): void {
    if (!this.layout.fileSystem.fileExists(uri) || this.layout.fileSystem.fileSize(uri) <= 0) {
      throw new ProjectRepositoryError(
        'E_IMPORT_FILE_MISSING',
        `The staged ${kind} file is missing or empty.`,
      );
    }
  }

  private async assertValidWaveform(uri: string, durationMs: number): Promise<void> {
    try {
      const raw: unknown = JSON.parse(await this.layout.fileSystem.readText(uri));
      const waveform = WaveformFileSchema.parse(raw);
      if (waveform.durationMs !== durationMs) {
        throw new Error('Waveform duration does not match the project duration.');
      }
    } catch (error) {
      throw new ProjectRepositoryError(
        'E_IMPORT_WAVEFORM_INVALID',
        'The staged waveform file is invalid.',
        { cause: error },
      );
    }
  }
}

export const projectRepository = new ProjectRepository();

export type { StorageFileSystem };

import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { MAX_PROJECT_NAME_LENGTH, MAX_VIDEO_BYTES, WAVEFORM_POINT_COUNT } from '@/constants/app';
import { COPY } from '@/constants/copy';
import type { DanceProject, WaveformFile } from '@/domain/project';
import { ProjectNameSchema, WaveformFileSchema, normalizeProjectName } from '@/domain/validation';
import { type CreateProjectInput, projectRepository } from '@/repositories/ProjectRepository';
import {
  type NativeAudioService,
  type NativeAudioSubscription,
  nativeAudioService,
} from '@/services/NativeAudioService';
import { developmentDiagnosticState } from '@/services/DevelopmentDiagnosticState';
import {
  PickedSourceMarkerSchema,
  type PickedSourceMarkerFile,
} from '@/services/PickedSourceMarker';
import { type StorageLayout, storageLayout } from '@/services/StorageLayout';
import {
  type CacheFileCleanupResult,
  type ImportFileAccess,
  hasEnoughFreeSpace,
  importFileAccess,
  isFileUriWithinDirectory,
  isPositiveByteCount,
  isWithinVideoSizeLimit,
  requiredFreeSpaceForImport,
  safePickedVideoExtension,
} from '@/utils/file';
import { AppError } from '@/utils/errors';
import { getFileNameFromUri, isLocalFileUri, parseLocalFileUri } from '@/utils/uri';
import type { ImportProgressEvent } from '../../modules/dance-audio';

export const IMPORT_KEEP_AWAKE_TAG = 'TempoLoopImport';

export type ImportCoordinatorErrorCode =
  | 'E_IMPORT_IN_PROGRESS'
  | 'E_PHOTO_PERMISSION_DENIED'
  | 'E_PICKER_RESULT_INVALID'
  | 'E_NOT_A_VIDEO'
  | 'E_INVALID_LOCAL_URI'
  | 'E_FILE_SIZE_UNAVAILABLE'
  | 'E_VIDEO_TOO_LARGE'
  | 'E_INSUFFICIENT_STORAGE'
  | 'E_WAVEFORM_INVALID'
  | 'E_NATIVE_RESULT_INVALID';

export interface ImportCoordinatorErrorDetails {
  readonly sizeBytes?: number;
  readonly maxSizeBytes?: number;
  readonly availableBytes?: number;
  readonly requiredBytes?: number;
}

export class ImportCoordinatorError extends Error {
  constructor(
    readonly code: ImportCoordinatorErrorCode,
    message: string,
    readonly details: ImportCoordinatorErrorDetails = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ImportCoordinatorError';
    Object.setPrototypeOf(this, ImportCoordinatorError.prototype);
  }
}

export interface SelectedVideo {
  readonly selectionId: string;
  readonly uri: string;
  readonly sourceExtension: string;
  readonly sizeBytes: number;
  readonly fileName: string | null;
  readonly suggestedName: string;
}

export type ImportUiPhase = 'preparing' | 'extracting' | 'waveform' | 'saving';

export interface ImportProgressSnapshot {
  readonly taskId: string;
  readonly phase: ImportUiPhase;
  readonly progress: number;
}

export interface ImportProjectRequest {
  readonly selection: SelectedVideo;
  readonly name: string;
  readonly onProgress?: (snapshot: ImportProgressSnapshot) => void;
}

export interface VideoPickerDependency {
  requestMediaLibraryPermissionsAsync(): Promise<{ readonly granted: boolean }>;
  launchImageLibraryAsync(
    options: ImagePicker.ImagePickerOptions,
  ): Promise<ImagePicker.ImagePickerResult>;
}

export interface KeepAwakeDependency {
  activate(tag: string): Promise<void>;
  deactivate(tag: string): Promise<void>;
}

export interface ImportNativeAudioDependency {
  extractAudio(
    taskId: string,
    inputVideoUri: string,
    outputAudioUri: string,
  ): ReturnType<NativeAudioService['extractAudio']>;
  generateWaveform(
    taskId: string,
    audioUri: string,
    pointCount: number,
  ): ReturnType<NativeAudioService['generateWaveform']>;
  cancelTask(taskId: string): Promise<void>;
  addImportProgressListener(
    listener: (event: ImportProgressEvent) => void,
  ): NativeAudioSubscription;
}

export interface ImportProjectRepository {
  initialize(): Promise<void>;
  createFromImportedFiles(input: CreateProjectInput): Promise<DanceProject>;
}

export interface ImportCoordinatorDependencies {
  readonly picker?: VideoPickerDependency;
  readonly fileAccess?: ImportFileAccess;
  readonly keepAwake?: KeepAwakeDependency;
  readonly nativeAudio?: ImportNativeAudioDependency;
  readonly repository?: ImportProjectRepository;
  readonly layout?: StorageLayout;
  readonly randomUuid?: () => string;
}

interface ActiveImport {
  readonly taskId: string;
  readonly onProgress?: (snapshot: ImportProgressSnapshot) => void;
  cancelRequested: boolean;
  commitStarted: boolean;
  finished: boolean;
}

const expoVideoPicker: VideoPickerDependency = {
  requestMediaLibraryPermissionsAsync: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
  launchImageLibraryAsync: (options) => ImagePicker.launchImageLibraryAsync(options),
};

const expoKeepAwake: KeepAwakeDependency = {
  activate: (tag) => activateKeepAwakeAsync(tag),
  deactivate: (tag) => deactivateKeepAwake(tag),
};

function importError(
  code: ImportCoordinatorErrorCode,
  message: string,
  details: ImportCoordinatorErrorDetails = {},
  cause?: unknown,
): ImportCoordinatorError {
  const error = new ImportCoordinatorError(code, message, details, { cause });
  developmentDiagnosticState.recordImportError(error, 'coordinator');
  return error;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function removeFileExtension(fileName: string): string {
  const finalDotIndex = fileName.lastIndexOf('.');
  if (finalDotIndex <= 0) {
    return fileName;
  }

  return fileName.slice(0, finalDotIndex);
}

function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join('');
}

export function suggestedProjectName(fileName: string | null, uri: string): string {
  const parsedUri = parseLocalFileUri(uri);
  const candidateFileName = fileName ?? getFileNameFromUri(parsedUri) ?? '';
  const candidate = normalizeProjectName(removeFileExtension(candidateFileName));
  const truncated = normalizeProjectName(truncateCodePoints(candidate, MAX_PROJECT_NAME_LENGTH));

  return truncated.length > 0 ? truncated : COPY.import.untitledProjectName;
}

function assertValidNativeExtractionResult(result: {
  readonly durationMs: number;
  readonly outputBytes: number;
}): void {
  if (!isPositiveByteCount(result.durationMs) || !isPositiveByteCount(result.outputBytes)) {
    throw importError(
      'E_NATIVE_RESULT_INVALID',
      'DanceAudio returned invalid extraction metadata.',
    );
  }
}

function cancelledError(): AppError {
  return new AppError('E_CANCELLED', 'The TempoLoop import was cancelled by the user.');
}

export class ImportCoordinator {
  private readonly picker: VideoPickerDependency;
  private readonly fileAccess: ImportFileAccess;
  private readonly keepAwake: KeepAwakeDependency;
  private readonly nativeAudio: ImportNativeAudioDependency;
  private readonly repository: ImportProjectRepository;
  private readonly layout: StorageLayout;
  private readonly randomUuid: () => string;
  private activeImport: ActiveImport | null = null;
  private selectionInProgress = false;

  constructor(dependencies: ImportCoordinatorDependencies = {}) {
    this.picker = dependencies.picker ?? expoVideoPicker;
    this.fileAccess = dependencies.fileAccess ?? importFileAccess;
    this.keepAwake = dependencies.keepAwake ?? expoKeepAwake;
    this.nativeAudio = dependencies.nativeAudio ?? nativeAudioService;
    this.repository = dependencies.repository ?? projectRepository;
    this.layout = dependencies.layout ?? storageLayout;
    this.randomUuid = dependencies.randomUuid ?? Crypto.randomUUID;
  }

  isImportActive(): boolean {
    return this.activeImport !== null;
  }

  async selectVideo(): Promise<SelectedVideo | null> {
    this.assertNoActiveImport();
    this.selectionInProgress = true;

    try {
      return await this.selectVideoInternal();
    } catch (error) {
      if (!(error instanceof ImportCoordinatorError)) {
        developmentDiagnosticState.recordImportError(error, 'selectVideo');
      }
      throw error;
    } finally {
      this.selectionInProgress = false;
    }
  }

  private async selectVideoInternal(): Promise<SelectedVideo | null> {
    await this.repository.initialize();

    const permission = await this.picker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw importError(
        'E_PHOTO_PERMISSION_DENIED',
        'Photo-library permission is required to select a video.',
      );
    }

    const result = await this.picker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      allowsMultipleSelection: false,
      selectionLimit: 1,
      shouldDownloadFromNetwork: true,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });

    if (result.canceled) {
      return null;
    }

    if (result.assets.length !== 1) {
      for (const candidate of result.assets) {
        this.tryCleanupPickedFile(candidate.uri);
      }
      throw importError(
        'E_PICKER_RESULT_INVALID',
        'The photo picker did not return exactly one video.',
      );
    }

    const asset = result.assets[0];
    if (asset === undefined) {
      throw importError('E_PICKER_RESULT_INVALID', 'The photo picker returned no selected video.');
    }

    let markedSelectionId: string | null = null;
    try {
      if (asset.type !== 'video') {
        throw importError('E_NOT_A_VIDEO', 'The selected photo-library item is not a video.');
      }

      if (!isLocalFileUri(asset.uri)) {
        throw importError(
          'E_INVALID_LOCAL_URI',
          'The selected video does not have a usable local file URI.',
        );
      }

      if (
        !isFileUriWithinDirectory(asset.uri, this.layout.fileSystem.cacheDirectoryUri) ||
        isFileUriWithinDirectory(asset.uri, this.layout.cacheRootUri)
      ) {
        throw importError(
          'E_INVALID_LOCAL_URI',
          'The selected video is not inside the app Cache directory.',
        );
      }

      const selectionId = this.randomUuid();
      this.preparePickedSourceMarker(selectionId, asset.uri);
      markedSelectionId = selectionId;

      const sizeBytes = this.determineFileSize(asset.fileSize, asset.uri);
      this.validateVideoSizeAndDisk(sizeBytes);
      const sourceExtension = safePickedVideoExtension(asset.fileName ?? null, asset.uri);
      const suggestedName = suggestedProjectName(asset.fileName ?? null, asset.uri);
      const ownedSource = await this.adoptPickedSource(asset.uri, selectionId, sourceExtension);

      return {
        selectionId,
        uri: ownedSource.uri,
        sourceExtension,
        sizeBytes: ownedSource.sizeBytes,
        fileName: asset.fileName ?? null,
        suggestedName,
      };
    } catch (error) {
      if (markedSelectionId === null) {
        this.tryCleanupPickedFile(asset.uri);
      } else {
        this.cleanupPickerSourceAfterFailedOwnership(asset.uri, markedSelectionId);
      }
      throw error;
    }
  }

  discardSelection(selection: SelectedVideo): void {
    this.tryCleanupOwnedSelection(selection.selectionId);
  }

  async importProject(request: ImportProjectRequest): Promise<DanceProject> {
    this.assertNoActiveImport();

    const normalizedName = ProjectNameSchema.parse(request.name);
    this.assertValidSelection(request.selection);

    const taskId = this.randomUuid();
    const projectId = this.randomUuid();
    const active: ActiveImport = {
      taskId,
      onProgress: request.onProgress,
      cancelRequested: false,
      commitStarted: false,
      finished: false,
    };
    this.activeImport = active;

    const stagingDirectoryUri = this.layout.stagingTaskDirectoryUri(taskId);
    const stagedAudioUri = this.layout.stagingAudioUri(taskId);
    const stagedWaveformUri = this.layout.stagingWaveformUri(taskId);
    let progressSubscription: NativeAudioSubscription | null = null;
    let keepAwakeActivated = false;
    let committedProject: DanceProject | null = null;

    try {
      this.emitProgress(active, 'preparing', 0);
      await this.repository.initialize();
      this.layout.ensureBaseDirectories();
      this.layout.fileSystem.ensureDirectory(stagingDirectoryUri);

      progressSubscription = this.nativeAudio.addImportProgressListener((event) =>
        this.handleNativeProgress(active, event),
      );
      await this.keepAwake.activate(IMPORT_KEEP_AWAKE_TAG);
      keepAwakeActivated = true;

      this.validateVideoSizeAndDisk(request.selection.sizeBytes);
      this.throwIfCancelled(active);
      this.emitProgress(active, 'preparing', 1);
      this.emitProgress(active, 'extracting', 0);

      const extraction = await this.nativeAudio.extractAudio(
        taskId,
        request.selection.uri,
        stagedAudioUri,
      );
      this.throwIfCancelled(active);
      assertValidNativeExtractionResult(extraction);
      this.emitProgress(active, 'extracting', 1);
      this.emitProgress(active, 'waveform', 0);

      const amplitudes = await this.nativeAudio.generateWaveform(
        taskId,
        stagedAudioUri,
        WAVEFORM_POINT_COUNT,
      );
      this.throwIfCancelled(active);

      const waveform = this.validateWaveform(amplitudes, extraction.durationMs);
      this.layout.fileSystem.writeText(stagedWaveformUri, JSON.stringify(waveform));
      await this.validatePersistedWaveform(stagedWaveformUri, extraction.durationMs);
      this.emitProgress(active, 'waveform', 1);
      this.throwIfCancelled(active);

      active.commitStarted = true;
      this.emitProgress(active, 'saving', 0);
      committedProject = await this.repository.createFromImportedFiles({
        id: projectId,
        name: normalizedName,
        durationMs: extraction.durationMs,
        sourceVideoBytes: request.selection.sizeBytes,
        stagedAudioUri,
        stagedWaveformUri,
      });
      this.emitProgress(active, 'saving', 1);
      return committedProject;
    } catch (error) {
      if (active.cancelRequested && committedProject === null) {
        throw cancelledError();
      }
      if (!(error instanceof ImportCoordinatorError)) {
        developmentDiagnosticState.recordImportError(error, 'importProject');
      }
      throw error;
    } finally {
      active.finished = true;
      try {
        progressSubscription?.remove();
      } catch {
        // Event cleanup is best effort; the active-task guard ignores late events.
      }

      try {
        this.layout.fileSystem.deleteDirectory(stagingDirectoryUri);
      } catch {
        // Launch recovery removes stale staging if the OS temporarily locks it.
      }

      this.tryCleanupOwnedSelection(request.selection.selectionId);

      if (keepAwakeActivated) {
        try {
          await this.keepAwake.deactivate(IMPORT_KEEP_AWAKE_TAG);
        } catch {
          // Do not turn a committed project into a reported import failure.
        }
      }

      if (this.activeImport === active) {
        this.activeImport = null;
      }
    }
  }

  async cancelActiveImport(): Promise<boolean> {
    const active = this.activeImport;
    if (active === null || active.finished || active.commitStarted) {
      return false;
    }

    active.cancelRequested = true;
    try {
      await this.nativeAudio.cancelTask(active.taskId);
    } catch (error) {
      if (!(error instanceof AppError && error.isCancellation)) {
        developmentDiagnosticState.recordImportError(error, 'cancelActiveImport');
        throw error;
      }
    }

    return true;
  }

  private assertNoActiveImport(): void {
    if (this.activeImport !== null || this.selectionInProgress) {
      throw importError(
        'E_IMPORT_IN_PROGRESS',
        'Only one TempoLoop video selection or import can run at a time.',
      );
    }
  }

  private assertValidSelection(selection: SelectedVideo): void {
    if (!isLocalFileUri(selection.uri)) {
      this.discardSelection(selection);
      throw importError(
        'E_INVALID_LOCAL_URI',
        'The selected video does not have a usable local file URI.',
      );
    }

    let expectedSourceUri: string;
    let selectionDirectoryUri: string;
    try {
      expectedSourceUri = this.layout.pickedSourceUri(
        selection.selectionId,
        selection.sourceExtension,
      );
      selectionDirectoryUri = this.layout.pickedSelectionDirectoryUri(selection.selectionId);
    } catch (error) {
      this.discardSelection(selection);
      throw importError(
        'E_INVALID_LOCAL_URI',
        'The selected video has invalid app-owned storage metadata.',
        {},
        error,
      );
    }

    if (
      selection.uri !== expectedSourceUri ||
      !isFileUriWithinDirectory(selection.uri, selectionDirectoryUri)
    ) {
      this.discardSelection(selection);
      throw importError(
        'E_INVALID_LOCAL_URI',
        'The selected video is not in its TempoLoop-owned Cache directory.',
      );
    }

    if (!isPositiveByteCount(selection.sizeBytes)) {
      this.discardSelection(selection);
      throw importError(
        'E_FILE_SIZE_UNAVAILABLE',
        'The selected video size could not be determined.',
      );
    }

    if (
      !this.layout.fileSystem.fileExists(selection.uri) ||
      this.layout.fileSystem.fileSize(selection.uri) !== selection.sizeBytes
    ) {
      this.discardSelection(selection);
      throw importError(
        'E_FILE_SIZE_UNAVAILABLE',
        'The app-owned selected video is missing or its size changed.',
      );
    }

    if (!isWithinVideoSizeLimit(selection.sizeBytes)) {
      this.discardSelection(selection);
      throw importError('E_VIDEO_TOO_LARGE', 'The selected video exceeds the import size limit.', {
        sizeBytes: selection.sizeBytes,
        maxSizeBytes: MAX_VIDEO_BYTES,
      });
    }
  }

  private async adoptPickedSource(
    pickerSourceUri: string,
    selectionId: string,
    sourceExtension: string,
  ): Promise<{ readonly uri: string; readonly sizeBytes: number }> {
    const ownedSourceUri = this.layout.pickedSourceUri(selectionId, sourceExtension);

    try {
      await this.layout.fileSystem.moveFile(pickerSourceUri, ownedSourceUri);

      if (!this.layout.fileSystem.fileExists(ownedSourceUri)) {
        throw importError(
          'E_FILE_SIZE_UNAVAILABLE',
          'The app-owned picker copy is missing after it was moved.',
        );
      }

      const movedSize = this.layout.fileSystem.fileSize(ownedSourceUri);
      if (!isPositiveByteCount(movedSize)) {
        throw importError(
          'E_FILE_SIZE_UNAVAILABLE',
          'The app-owned picker copy is empty after it was moved.',
        );
      }

      this.validateVideoSizeAndDisk(movedSize);
      return {
        uri: ownedSourceUri,
        sizeBytes: movedSize,
      };
    } catch (error) {
      if (error instanceof ImportCoordinatorError) {
        throw error;
      }
      throw importError(
        'E_PICKER_RESULT_INVALID',
        'The selected video could not be moved into TempoLoop-owned Cache storage.',
        {},
        error,
      );
    }
  }

  private preparePickedSourceMarker(selectionId: string, pickerSourceUri: string): void {
    const marker: PickedSourceMarkerFile = {
      schemaVersion: 1,
      pickerSourceUri,
    };
    const selectionDirectoryUri = this.layout.pickedSelectionDirectoryUri(selectionId);

    this.layout.ensureBaseDirectories();
    this.layout.fileSystem.ensureDirectory(selectionDirectoryUri);
    this.layout.fileSystem.writeText(
      this.layout.pickedSourceMarkerUri(selectionId),
      JSON.stringify(PickedSourceMarkerSchema.parse(marker)),
    );
  }

  private cleanupPickerSourceAfterFailedOwnership(
    pickerSourceUri: string,
    selectionId: string,
  ): void {
    const cleanupResult = this.tryCleanupPickedFile(pickerSourceUri);
    if (cleanupResult !== null) {
      this.tryCleanupOwnedSelection(selectionId);
    }
  }

  private determineFileSize(reportedSize: number | undefined, uri: string): number {
    if (isPositiveByteCount(reportedSize)) {
      return reportedSize;
    }

    try {
      const fallbackSize = this.fileAccess.getFileSize(uri);
      if (isPositiveByteCount(fallbackSize)) {
        return fallbackSize;
      }
    } catch (error) {
      throw importError(
        'E_FILE_SIZE_UNAVAILABLE',
        'The selected video size could not be read.',
        {},
        error,
      );
    }

    throw importError(
      'E_FILE_SIZE_UNAVAILABLE',
      'The selected video size could not be determined.',
    );
  }

  private validateVideoSizeAndDisk(sizeBytes: number): void {
    if (!isWithinVideoSizeLimit(sizeBytes)) {
      throw importError('E_VIDEO_TOO_LARGE', 'The selected video exceeds the import size limit.', {
        sizeBytes,
        maxSizeBytes: MAX_VIDEO_BYTES,
      });
    }

    const requiredBytes = requiredFreeSpaceForImport(sizeBytes);
    let availableBytes: number;
    try {
      availableBytes = this.fileAccess.getAvailableDiskSpace();
    } catch (error) {
      throw importError(
        'E_INSUFFICIENT_STORAGE',
        'Available disk space could not be determined safely.',
        { requiredBytes },
        error,
      );
    }

    if (!hasEnoughFreeSpace(availableBytes, sizeBytes)) {
      throw importError(
        'E_INSUFFICIENT_STORAGE',
        'There is not enough free storage to import this video safely.',
        {
          availableBytes: Number.isFinite(availableBytes) ? availableBytes : undefined,
          requiredBytes,
        },
      );
    }
  }

  private validateWaveform(amplitudes: number[], durationMs: number): WaveformFile {
    try {
      return WaveformFileSchema.parse({
        schemaVersion: 1,
        pointCount: WAVEFORM_POINT_COUNT,
        durationMs,
        amplitudes,
      });
    } catch (error) {
      throw importError(
        'E_WAVEFORM_INVALID',
        'DanceAudio returned invalid waveform data.',
        {},
        error,
      );
    }
  }

  private async validatePersistedWaveform(waveformUri: string, durationMs: number): Promise<void> {
    try {
      const raw: unknown = JSON.parse(await this.layout.fileSystem.readText(waveformUri));
      const waveform = WaveformFileSchema.parse(raw);
      if (waveform.durationMs !== durationMs) {
        throw new Error('The persisted waveform duration does not match the audio.');
      }
    } catch (error) {
      throw importError(
        'E_WAVEFORM_INVALID',
        'The staged waveform file failed validation.',
        {},
        error,
      );
    }
  }

  private handleNativeProgress(active: ActiveImport, event: ImportProgressEvent): void {
    if (
      this.activeImport !== active ||
      active.finished ||
      active.cancelRequested ||
      event.taskId !== active.taskId
    ) {
      return;
    }

    this.emitProgress(active, event.phase, clampProgress(event.progress));
  }

  private emitProgress(active: ActiveImport, phase: ImportUiPhase, progress: number): void {
    if (this.activeImport !== active || active.finished) {
      return;
    }

    try {
      active.onProgress?.({
        taskId: active.taskId,
        phase,
        progress: clampProgress(progress),
      });
    } catch {
      // A rendering callback cannot be allowed to abort the import transaction.
    }
  }

  private throwIfCancelled(active: ActiveImport): void {
    if (active.cancelRequested) {
      throw cancelledError();
    }
  }

  private tryCleanupOwnedSelection(selectionId: string): void {
    try {
      this.layout.fileSystem.deleteDirectory(this.layout.pickedSelectionDirectoryUri(selectionId));
    } catch {
      // The next repository recovery removes all abandoned Picked directories.
    }
  }

  private tryCleanupPickedFile(uri: string): CacheFileCleanupResult | null {
    if (isFileUriWithinDirectory(uri, this.layout.cacheRootUri)) {
      return 'not-owned';
    }

    try {
      return this.fileAccess.deleteCacheFileIfOwned(uri);
    } catch {
      // Callers with a marker preserve it so launch recovery can retry safely.
      return null;
    }
  }
}

export const importCoordinator = new ImportCoordinator();

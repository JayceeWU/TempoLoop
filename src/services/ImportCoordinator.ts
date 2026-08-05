import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { MAX_AUDIO_BYTES, MAX_PROJECT_NAME_LENGTH, MAX_VIDEO_BYTES } from '@/constants/app';
import { COPY } from '@/constants/copy';
import type { DanceProject } from '@/domain/project';
import { ProjectNameSchema, normalizeProjectName } from '@/domain/validation';
import { type FinalizeImportInput, projectRepository } from '@/repositories/ProjectRepository';
import { developmentDiagnosticState } from '@/services/DevelopmentDiagnosticState';
import { type StorageLayout, storageLayout } from '@/services/StorageLayout';
import {
  type StructuredDiagnosticsRecorder,
  structuredDevelopmentDiagnostics,
} from '@/services/StructuredDevelopmentDiagnostics';
import {
  TempoLoopMediaService,
  TempoLoopMediaServiceError,
  tempoLoopMediaService,
} from '@/services/TempoLoopMediaService';
import {
  importStateController,
  type ImportSelectionState,
  type ImportStateController,
  type ImportTerminalError,
} from '@/stores/useImportStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { waveformGenerationCoordinator } from '@/services/WaveformGenerationCoordinator';
import {
  assertImportMediaResult,
  type ImportMediaResult,
  type ImportProgressEvent,
  type ImportStage,
  type TempoLoopMediaSubscription,
  type MediaInspection,
  type PickedMediaSource,
  type SourceMediaKind,
} from '../../modules/tempoloop-media';

export const IMPORT_KEEP_AWAKE_TAG = 'TempoLoopImport';

export type ImportCoordinatorErrorCode =
  | 'E_IMPORT_IN_PROGRESS'
  | 'E_PICKER_RESULT_INVALID'
  | 'E_INVALID_LOCAL_URI'
  | 'E_AUDIO_TOO_LARGE'
  | 'E_VIDEO_TOO_LARGE'
  | 'E_NATIVE_RESULT_INVALID'
  | 'E_POST_COMMIT_REFRESH_FAILED';

export interface ImportCoordinatorErrorDetails {
  readonly sizeBytes?: number;
  readonly maxSizeBytes?: number;
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

/** Picker metadata only. JavaScript never opens, copies, converts, or deletes this URI. */
export interface SelectedMedia {
  readonly selectionId: string;
  readonly sourceKindHint: SourceMediaKind;
  readonly uri: string;
  readonly sizeBytes: number | null;
  readonly mimeType: string | null;
  readonly fileName: string | null;
  readonly suggestedName: string;
}

/**
 * Android providers usually expose renamed `.m4s` files as either an ISO media
 * segment or an opaque binary document. Native inspection remains authoritative
 * and rejects any selected document that does not contain a decodable audio track.
 */
export const AUDIO_DOCUMENT_PICKER_MIME_TYPES = [
  'audio/*',
  'application/octet-stream',
  'video/iso.segment',
] as const;

export type ImportUiPhase = 'preparing' | 'extracting' | 'saving';

export interface ImportProgressSnapshot {
  /** Compatibility alias for the operation ID used by the current sheet. */
  readonly taskId: string;
  readonly operationId?: string;
  readonly phase: ImportUiPhase;
  readonly stage?: ImportStage;
  readonly progress: number;
  readonly stageProgress?: number | null;
  readonly overallProgress?: number | null;
}

export interface ImportProjectRequest {
  readonly selection: SelectedMedia;
  readonly name: string;
  readonly onProgress?: (snapshot: ImportProgressSnapshot) => void;
}

export interface DocumentPickerDependency {
  getDocumentAsync(
    options: DocumentPicker.DocumentPickerOptions,
  ): Promise<DocumentPicker.DocumentPickerResult>;
}

export interface KeepAwakeDependency {
  activate(tag: string): Promise<void>;
  deactivate(tag: string): Promise<void>;
}

export type ImportMediaDependency = Pick<
  TempoLoopMediaService,
  | 'pickGalleryVideo'
  | 'inspectMedia'
  | 'importProjectMedia'
  | 'cancelImport'
  | 'addImportProgressListener'
>;

export interface ImportProjectRepository {
  initialize(): Promise<void>;
  createImportDirectory(projectId: string): string | Promise<string>;
  removeImportDirectory(projectId: string): void | Promise<void>;
  finalizeImport(input: FinalizeImportInput): Promise<DanceProject>;
}

export interface ImportCoordinatorDependencies {
  readonly picker?: DocumentPickerDependency;
  readonly keepAwake?: KeepAwakeDependency;
  readonly media?: ImportMediaDependency;
  readonly repository?: ImportProjectRepository;
  readonly layout?: Pick<StorageLayout, 'importPartialAudioUri'>;
  readonly importState?: ImportStateController;
  readonly refreshProjects?: () => Promise<void>;
  readonly randomUuid?: () => string;
  readonly diagnostics?: StructuredDiagnosticsRecorder;
  readonly waveformScheduler?: {
    hasPendingWork(): boolean;
    enqueueProject(project: DanceProject): void;
  };
}

interface ActiveImport {
  readonly operationId: string;
  readonly projectId: string;
  readonly onProgress?: (snapshot: ImportProgressSnapshot) => void;
  cancelRequested: boolean;
  commitStarted: boolean;
  finished: boolean;
  diagnosticStage: ImportStage | null;
}

const expoDocumentPicker: DocumentPickerDependency = {
  getDocumentAsync: (options) => DocumentPicker.getDocumentAsync(options),
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

function removeFileExtension(fileName: string): string {
  const finalDotIndex = fileName.lastIndexOf('.');
  return finalDotIndex <= 0 ? fileName : fileName.slice(0, finalDotIndex);
}

function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join('');
}

/** The URI is intentionally ignored; suggestions use picker display metadata only. */
export function suggestedProjectName(fileName: string | null, _uri?: string): string {
  const candidate = normalizeProjectName(
    truncateCodePoints(removeFileExtension(fileName ?? ''), MAX_PROJECT_NAME_LENGTH),
  );
  const parsed = ProjectNameSchema.safeParse(candidate);
  return parsed.success ? parsed.data : COPY.import.untitledProjectName;
}

function isSupportedPickerUri(uri: string): boolean {
  return (
    uri.length > 'file://'.length &&
    !/[\u0000-\u001f\u007f]/u.test(uri) &&
    (uri.startsWith('content://') || uri.startsWith('file://'))
  );
}

/** Picker zero and missing sizes are both unreliable hints, not empty files. */
function normalizeSizeHint(size: number | undefined): number | null {
  return Number.isSafeInteger(size) && size !== undefined && size > 0 ? size : null;
}

function normalizeMimeTypeHint(mimeType: string | undefined): string | null {
  const normalized = mimeType?.trim().toLowerCase();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
}

function normalizeFileNameHint(fileName: string | null | undefined): string | null {
  const normalized = fileName?.trim();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
}

function selectedMediaToState(selection: SelectedMedia): ImportSelectionState {
  return {
    selectionId: selection.selectionId,
    sourceKindHint: selection.sourceKindHint,
    sourceUri: selection.uri,
    displayName: selection.fileName,
    sizeBytes: selection.sizeBytes,
    mimeType: selection.mimeType,
    suggestedName: selection.suggestedName,
  };
}

function uiPhase(stage: ImportStage): ImportUiPhase {
  switch (stage) {
    case 'inspecting':
      return 'preparing';
    case 'exporting':
      return 'extracting';
    case 'finalizing':
      return 'saving';
  }
}

function clampProgress(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
}

function terminalError(error: unknown): ImportTerminalError {
  if (error instanceof TempoLoopMediaServiceError) {
    return { code: error.code, userMessage: error.userMessage };
  }
  if (error instanceof ImportCoordinatorError) {
    return { code: error.code, userMessage: COPY.import.failureMessage };
  }
  return { code: 'E_UNKNOWN_NATIVE', userMessage: COPY.import.failureMessage };
}

function cancelledError(cause?: unknown): TempoLoopMediaServiceError {
  return new TempoLoopMediaServiceError(
    'E_IMPORT_CANCELLED',
    'The TempoLoop import was cancelled.',
    cause,
  );
}

export class ImportCoordinator {
  private readonly picker: DocumentPickerDependency;
  private readonly keepAwake: KeepAwakeDependency;
  private readonly media: ImportMediaDependency;
  private readonly repository: ImportProjectRepository;
  private readonly layout: Pick<StorageLayout, 'importPartialAudioUri'>;
  private readonly importState: ImportStateController;
  private readonly refreshProjects: () => Promise<void>;
  private readonly randomUuid: () => string;
  private readonly diagnostics: StructuredDiagnosticsRecorder;
  private readonly waveformScheduler: {
    hasPendingWork(): boolean;
    enqueueProject(project: DanceProject): void;
  };
  private activeImport: ActiveImport | null = null;

  constructor(dependencies: ImportCoordinatorDependencies = {}) {
    this.picker = dependencies.picker ?? expoDocumentPicker;
    this.keepAwake = dependencies.keepAwake ?? expoKeepAwake;
    this.media = dependencies.media ?? tempoLoopMediaService;
    this.repository = dependencies.repository ?? projectRepository;
    this.layout = dependencies.layout ?? storageLayout;
    this.importState = dependencies.importState ?? importStateController();
    this.refreshProjects =
      dependencies.refreshProjects ?? (() => useProjectStore.getState().refresh());
    this.randomUuid = dependencies.randomUuid ?? Crypto.randomUUID;
    this.diagnostics = dependencies.diagnostics ?? structuredDevelopmentDiagnostics;
    this.waveformScheduler =
      dependencies.waveformScheduler ??
      (dependencies.repository === undefined
        ? waveformGenerationCoordinator
        : { hasPendingWork: () => false, enqueueProject: () => undefined });
  }

  isImportActive(): boolean {
    return this.activeImport !== null;
  }

  async selectVideoFromGallery(): Promise<SelectedMedia | null> {
    if (
      this.activeImport !== null ||
      this.waveformScheduler.hasPendingWork() ||
      !this.importState.tryBeginSelection()
    ) {
      throw importError(
        'E_IMPORT_IN_PROGRESS',
        'Only one TempoLoop media selection or import can run at a time.',
      );
    }

    try {
      const picked = await this.media.pickGalleryVideo();
      if (picked === null) {
        this.importState.cancelSelection();
        return null;
      }
      const selection = this.createSelection('video', picked);
      this.importState.finishSelection(selectedMediaToState(selection));
      return selection;
    } catch (error) {
      this.importState.failSelection(terminalError(error));
      if (!(error instanceof ImportCoordinatorError)) {
        developmentDiagnosticState.recordImportError(error, 'selectVideoFromGallery');
      }
      throw error;
    }
  }

  async selectAudio(): Promise<SelectedMedia | null> {
    if (
      this.activeImport !== null ||
      this.waveformScheduler.hasPendingWork() ||
      !this.importState.tryBeginSelection()
    ) {
      throw importError(
        'E_IMPORT_IN_PROGRESS',
        'Only one TempoLoop media selection or import can run at a time.',
      );
    }

    try {
      const result = await this.picker.getDocumentAsync({
        type: [...AUDIO_DOCUMENT_PICKER_MIME_TYPES],
        multiple: false,
        copyToCacheDirectory: false,
      });
      if (result.canceled) {
        this.importState.cancelSelection();
        return null;
      }
      if (result.assets.length !== 1 || result.assets[0] === undefined) {
        throw importError(
          'E_PICKER_RESULT_INVALID',
          'The document picker did not return exactly one audio file.',
        );
      }

      const asset = result.assets[0];
      const selection = this.createSelection('audio', {
        uri: asset.uri,
        sizeBytes: normalizeSizeHint(asset.size),
        mimeType: normalizeMimeTypeHint(asset.mimeType),
        fileName: normalizeFileNameHint(asset.name),
      });
      this.importState.finishSelection(selectedMediaToState(selection));
      return selection;
    } catch (error) {
      this.importState.failSelection(terminalError(error));
      if (!(error instanceof ImportCoordinatorError)) {
        developmentDiagnosticState.recordImportError(error, 'selectAudio');
      }
      throw error;
    }
  }

  /** The provider owns the URI; abandoning naming only clears in-memory state. */
  discardSelection(selection: SelectedMedia): void {
    this.importState.discardSelection(selection.selectionId);
  }

  async importProject(request: ImportProjectRequest): Promise<DanceProject> {
    if (this.activeImport !== null || this.waveformScheduler.hasPendingWork()) {
      throw importError('E_IMPORT_IN_PROGRESS', 'Another TempoLoop import is already running.');
    }
    const normalizedName = ProjectNameSchema.parse(request.name);
    this.assertValidSelection(request.selection);

    const operationId = this.randomUuid();
    const projectId = this.randomUuid();
    const audioUri = this.layout.importPartialAudioUri(projectId);
    if (
      !this.importState.tryBeginImport({
        operationId,
        projectId,
        selection: selectedMediaToState(request.selection),
        projectName: normalizedName,
      })
    ) {
      throw importError(
        'E_IMPORT_IN_PROGRESS',
        'The selected media is no longer available for this import.',
      );
    }

    const active: ActiveImport = {
      operationId,
      projectId,
      onProgress: request.onProgress,
      cancelRequested: false,
      commitStarted: false,
      finished: false,
      diagnosticStage: null,
    };
    this.activeImport = active;
    this.diagnostics.recordImportStarted({ operationId, projectId });

    let subscription: TempoLoopMediaSubscription | null = null;
    let keepAwakeActive = false;
    let committedProject: DanceProject | null = null;

    try {
      await this.repository.initialize();
      await this.repository.createImportDirectory(projectId);
      subscription = this.media.addImportProgressListener((event) =>
        this.handleNativeProgress(active, event),
      );
      await this.keepAwake.activate(IMPORT_KEEP_AWAKE_TAG);
      keepAwakeActive = true;

      this.emitProgress(active, {
        operationId,
        stage: 'inspecting',
        stageProgress: 0,
        overallProgress: 0,
      });
      this.throwIfCancelled(active);
      const inspection = await this.media.inspectMedia({
        sourceUri: request.selection.uri,
        maxAudioSourceBytes: MAX_AUDIO_BYTES,
        maxVideoSourceBytes: MAX_VIDEO_BYTES,
      });
      this.throwIfCancelled(active);
      this.validateInspection(inspection);
      this.diagnostics.recordSourceInspected({
        operationId,
        sourceSizeBytes: inspection.sourceSizeBytes,
        durationMs: inspection.durationMs,
        audioMimeType: inspection.audioMimeType,
        sampleRate: inspection.sampleRate,
        channelCount: inspection.channelCount,
      });

      const result = await this.media.importProjectMedia({
        operationId,
        sourceUri: request.selection.uri,
        outputAudioUri: audioUri,
        maxAudioSourceBytes: MAX_AUDIO_BYTES,
        maxVideoSourceBytes: MAX_VIDEO_BYTES,
      });
      this.throwIfCancelled(active);
      assertImportMediaResult(result);
      this.validateNativeResult(result, audioUri);
      this.diagnostics.recordExportCompleted({
        operationId,
        durationMs: result.durationMs,
        outputSizeBytes: result.audioSizeBytes,
      });
      // TempoLoopMedia has already opened the completed output twice with
      // MediaExtractor and verified one AAC audio track, a positive duration,
      // a non-empty file, and stable metadata. Do not attach this staging file
      // to the shared expo-audio player: SDK 57's Android replace(null) bridge
      // cannot reliably release it on every installed Development binary.
      this.throwIfCancelled(active);

      active.commitStarted = true;
      committedProject = await this.repository.finalizeImport({
        projectId,
        name: normalizedName,
        sourceDisplayName: request.selection.fileName,
        inspection,
        result,
      });

      try {
        await this.refreshProjects();
      } catch (error) {
        throw importError(
          'E_POST_COMMIT_REFRESH_FAILED',
          'The project was saved, but the project list could not be refreshed.',
          {},
          error,
        );
      }

      this.importState.completeImport(operationId, projectId);
      this.diagnostics.recordImportCompleted({
        operationId,
        projectId,
        stage: active.diagnosticStage,
      });
      return committedProject;
    } catch (error) {
      if (!active.commitStarted && !active.cancelRequested) {
        try {
          await this.media.cancelImport(active.operationId);
        } catch {
          // Native cancellation is idempotent; preserve the original failure.
        }
      }
      const finalError =
        active.cancelRequested ||
        (error instanceof TempoLoopMediaServiceError && error.isCancellation)
          ? cancelledError(error)
          : error;
      this.importState.failImport(operationId, terminalError(finalError));
      if (finalError instanceof TempoLoopMediaServiceError && finalError.isCancellation) {
        this.diagnostics.recordImportCanceled({
          operationId,
          projectId,
          stage: active.diagnosticStage,
        });
      } else {
        this.diagnostics.recordImportFailed({
          operationId,
          projectId,
          stage: active.diagnosticStage,
          error: finalError,
        });
        if (
          typeof finalError === 'object' &&
          finalError !== null &&
          'code' in finalError &&
          finalError.code === 'E_AUDIO_LOAD_FAILED'
        ) {
          this.diagnostics.recordAudioLoadFailure({ operationId, error: finalError });
        }
      }
      if (
        !(finalError instanceof TempoLoopMediaServiceError && finalError.isCancellation) &&
        !(finalError instanceof ImportCoordinatorError)
      ) {
        developmentDiagnosticState.recordImportError(finalError, 'importProject');
      }
      throw finalError;
    } finally {
      active.finished = true;
      try {
        subscription?.remove();
      } catch {
        // A stale event is rejected by operation ID and active-task identity.
      }
      if (committedProject === null) {
        try {
          await this.repository.removeImportDirectory(projectId);
        } catch {
          // Launch recovery retries cleanup of app-owned imports after its grace period.
        }
      }
      if (keepAwakeActive) {
        try {
          await this.keepAwake.deactivate(IMPORT_KEEP_AWAKE_TAG);
        } catch {
          // Releasing a wake lock cannot change the import transaction result.
        }
      }
      if (this.activeImport === active) {
        this.activeImport = null;
      }
      if (committedProject !== null) {
        this.waveformScheduler.enqueueProject(committedProject);
      }
    }
  }

  async cancelActiveImport(): Promise<boolean> {
    const active = this.activeImport;
    if (active === null || active.finished || active.commitStarted) {
      return false;
    }
    if (active.cancelRequested) {
      return true;
    }

    active.cancelRequested = true;
    this.importState.requestCancel(active.operationId);
    try {
      await this.media.cancelImport(active.operationId);
    } catch (error) {
      // The local cancellation flag is authoritative. Native cancellation is
      // idempotent and its rejection must never trigger a user alert.
      developmentDiagnosticState.recordImportError(cancelledError(error), 'cancelActiveImport');
    }
    return true;
  }

  private createSelection(
    sourceKindHint: SourceMediaKind,
    source: PickedMediaSource,
  ): SelectedMedia {
    if (!isSupportedPickerUri(source.uri)) {
      throw importError('E_INVALID_LOCAL_URI', 'Select a local media file again.');
    }
    const fileName = normalizeFileNameHint(source.fileName);
    const selection: SelectedMedia = {
      selectionId: this.randomUuid(),
      sourceKindHint,
      uri: source.uri,
      sizeBytes: source.sizeBytes,
      mimeType: source.mimeType,
      fileName,
      suggestedName: suggestedProjectName(fileName),
    };
    this.assertValidSelection(selection);
    return selection;
  }

  private assertValidSelection(selection: SelectedMedia): void {
    if (!isSupportedPickerUri(selection.uri)) {
      throw importError('E_INVALID_LOCAL_URI', 'Select the media again with the Android picker.');
    }
    this.validateSizeHint(selection.sizeBytes, selection.sourceKindHint);
  }

  private validateSizeHint(sizeBytes: number | null, sourceKind: SourceMediaKind): void {
    if (sizeBytes === null) {
      return;
    }
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw importError(
        'E_PICKER_RESULT_INVALID',
        'The document picker returned invalid source metadata.',
      );
    }
    const maxSizeBytes = sourceKind === 'audio' ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
    if (sizeBytes > maxSizeBytes) {
      throw importError(
        sourceKind === 'audio' ? 'E_AUDIO_TOO_LARGE' : 'E_VIDEO_TOO_LARGE',
        `The selected ${sourceKind} exceeds its size limit.`,
        {
          sizeBytes,
          maxSizeBytes,
        },
      );
    }
  }

  private validateInspection(inspection: MediaInspection): void {
    if (inspection.sourceSizeBytes !== null) {
      this.validateSizeHint(inspection.sourceSizeBytes, inspection.sourceKind);
    }
  }

  private validateNativeResult(result: ImportMediaResult, expectedAudioUri: string): void {
    if (result.audioUri !== expectedAudioUri) {
      throw importError(
        'E_NATIVE_RESULT_INVALID',
        'The native media module returned an unexpected audio destination.',
      );
    }
  }

  private handleNativeProgress(active: ActiveImport, event: ImportProgressEvent): void {
    if (
      this.activeImport !== active ||
      active.finished ||
      active.cancelRequested ||
      event.operationId !== active.operationId
    ) {
      return;
    }
    this.emitProgress(active, event);
  }

  private emitProgress(active: ActiveImport, event: ImportProgressEvent): void {
    if (this.activeImport !== active || active.finished) {
      return;
    }
    const stageProgress = clampProgress(event.stageProgress);
    const overallProgress = clampProgress(event.overallProgress);
    if (active.diagnosticStage !== event.stage) {
      active.diagnosticStage = event.stage;
      this.diagnostics.recordImportStage({
        operationId: active.operationId,
        stage: event.stage,
        stageProgress,
        overallProgress,
      });
    }
    this.importState.updateProgress(active.operationId, {
      stage: event.stage,
      stageProgress,
      overallProgress,
    });
    try {
      active.onProgress?.({
        taskId: active.operationId,
        operationId: active.operationId,
        phase: uiPhase(event.stage),
        stage: event.stage,
        progress: overallProgress ?? stageProgress ?? 0,
        stageProgress,
        overallProgress,
      });
    } catch {
      // Rendering callbacks cannot abort a native transaction.
    }
  }

  private throwIfCancelled(active: ActiveImport): void {
    if (active.cancelRequested) {
      throw cancelledError();
    }
  }
}

export const importCoordinator = new ImportCoordinator();

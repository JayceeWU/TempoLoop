import { developmentLog, type DevelopmentLog } from '@/services/DevelopmentLog';
import type { AudioLoadFailureStage } from '@/services/PartialAudioValidator';

export type DiagnosticImportStage = 'inspecting' | 'exporting' | 'waveform' | 'finalizing';

export interface StructuredDevelopmentDiagnosticsOptions {
  readonly enabled?: boolean;
  readonly log?: DevelopmentLog;
  readonly segmentOvershootEnabled?: boolean;
}

interface ImportIdentity {
  readonly operationId: string;
  readonly projectId: string;
}

interface ImportStageDiagnostic {
  readonly operationId: string;
  readonly stage: DiagnosticImportStage;
  readonly stageProgress: number | null;
  readonly overallProgress: number | null;
}

interface InspectedSourceDiagnostic {
  readonly operationId: string;
  readonly sourceSizeBytes: number | null;
  readonly durationMs: number;
  readonly audioMimeType: string | null;
  readonly sampleRate: number | null;
  readonly channelCount: number | null;
}

interface ImportMediaDiagnostic {
  readonly operationId: string;
  readonly durationMs: number;
  readonly outputSizeBytes: number;
}

interface ImportWaveformDiagnostic {
  readonly operationId: string;
  readonly durationMs: number;
  readonly binCount: number;
}

interface ImportTerminalDiagnostic extends ImportIdentity {
  readonly stage: DiagnosticImportStage | null;
}

interface ImportFailureDiagnostic extends ImportTerminalDiagnostic {
  readonly error: unknown;
}

interface LoadFailureDiagnostic {
  readonly operationId?: string;
  readonly projectId?: string;
  readonly error: unknown;
}

interface StalePlaybackDiagnostic {
  readonly command: string;
  readonly commandGeneration: number;
  readonly currentGeneration: number;
}

interface SegmentOvershootDiagnostic {
  readonly projectId: string;
  readonly segmentIndex: number;
  readonly commandGeneration: number;
  readonly rate: number;
  readonly overshootMs: number;
}

export interface StructuredDiagnosticsRecorder {
  recordImportStarted(input: ImportIdentity): void;
  recordImportStage(input: ImportStageDiagnostic): void;
  recordSourceInspected(input: InspectedSourceDiagnostic): void;
  recordExportCompleted(input: ImportMediaDiagnostic): void;
  recordWaveformCompleted(input: ImportWaveformDiagnostic): void;
  recordImportCompleted(input: ImportTerminalDiagnostic): void;
  recordImportCanceled(input: ImportTerminalDiagnostic): void;
  recordImportFailed(input: ImportFailureDiagnostic): void;
  recordProjectLoadFailure(input: { readonly projectId: string; readonly error: unknown }): void;
  recordAudioLoadFailure(input: LoadFailureDiagnostic): void;
  recordStalePlaybackCommand(input: StalePlaybackDiagnostic): void;
  recordSegmentEndOvershoot(input: SegmentOvershootDiagnostic): void;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_OPERATION = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const SAFE_MIME_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

function safeIdentifier(value: string): string {
  return SAFE_IDENTIFIER.test(value) ? value : 'invalid-id';
}

function safeOperation(value: string): string {
  return SAFE_OPERATION.test(value) ? value : 'unknown';
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^E_[A-Z0-9_]{1,64}$/.test(error.code)
  ) {
    return error.code;
  }
  return 'E_UNKNOWN';
}

function safeAudioLoadFailureStage(error: unknown): AudioLoadFailureStage | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'loadFailureStage' in error &&
    (error.loadFailureStage === 'prepare' ||
      error.loadFailureStage === 'replace' ||
      error.loadFailureStage === 'native-status' ||
      error.loadFailureStage === 'timeout' ||
      error.loadFailureStage === 'cleanup')
  ) {
    return error.loadFailureStage;
  }
  return null;
}

function safeOptionalInteger(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safePositiveInteger(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function safeProgress(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

/**
 * Small, development-only structured event boundary. Callers cannot supply
 * names, URIs, paths, filenames, media bytes, or waveform samples.
 */
export class StructuredDevelopmentDiagnostics implements StructuredDiagnosticsRecorder {
  private readonly enabled: boolean;
  private readonly log: DevelopmentLog;
  private readonly segmentOvershootEnabled: boolean;

  constructor(options: StructuredDevelopmentDiagnosticsOptions = {}) {
    this.enabled = options.enabled ?? __DEV__;
    this.log = options.log ?? developmentLog;
    this.segmentOvershootEnabled = options.segmentOvershootEnabled ?? this.enabled;
  }

  recordImportStarted(input: ImportIdentity): void {
    this.record('info', 'import.started', {
      operationId: safeIdentifier(input.operationId),
      projectId: safeIdentifier(input.projectId),
    });
  }

  recordImportStage(input: ImportStageDiagnostic): void {
    this.record('debug', 'import.stage', {
      operationId: safeIdentifier(input.operationId),
      stage: input.stage,
      stageProgress: safeProgress(input.stageProgress),
      overallProgress: safeProgress(input.overallProgress),
    });
  }

  recordSourceInspected(input: InspectedSourceDiagnostic): void {
    this.record('info', 'import.source.inspected', {
      operationId: safeIdentifier(input.operationId),
      sourceSizeBytes: safeOptionalInteger(input.sourceSizeBytes),
      durationMs: safePositiveInteger(input.durationMs),
      audioMimeType:
        input.audioMimeType !== null && SAFE_MIME_TYPE.test(input.audioMimeType)
          ? input.audioMimeType
          : null,
      sampleRate: safeOptionalInteger(input.sampleRate),
      channelCount: safeOptionalInteger(input.channelCount),
    });
  }

  recordExportCompleted(input: ImportMediaDiagnostic): void {
    this.record('info', 'import.export.completed', {
      operationId: safeIdentifier(input.operationId),
      durationMs: safePositiveInteger(input.durationMs),
      outputSizeBytes: safePositiveInteger(input.outputSizeBytes),
    });
  }

  recordWaveformCompleted(input: ImportWaveformDiagnostic): void {
    this.record('info', 'import.waveform.completed', {
      operationId: safeIdentifier(input.operationId),
      durationMs: safePositiveInteger(input.durationMs),
      binCount: safePositiveInteger(input.binCount),
    });
  }

  recordImportCompleted(input: ImportTerminalDiagnostic): void {
    this.record('info', 'import.completed', this.terminalContext(input));
  }

  recordImportCanceled(input: ImportTerminalDiagnostic): void {
    this.record('info', 'import.canceled', {
      ...this.terminalContext(input),
      code: 'E_IMPORT_CANCELLED',
    });
  }

  recordImportFailed(input: ImportFailureDiagnostic): void {
    this.record('error', 'import.failed', {
      ...this.terminalContext(input),
      code: safeErrorCode(input.error),
    });
  }

  recordProjectLoadFailure(input: { readonly projectId: string; readonly error: unknown }): void {
    this.record('error', 'project.load.failed', {
      projectId: safeIdentifier(input.projectId),
      code: safeErrorCode(input.error),
    });
  }

  recordAudioLoadFailure(input: LoadFailureDiagnostic): void {
    this.record('error', 'audio.load.failed', {
      operationId: input.operationId === undefined ? null : safeIdentifier(input.operationId),
      projectId: input.projectId === undefined ? null : safeIdentifier(input.projectId),
      code: safeErrorCode(input.error),
      failureStage: safeAudioLoadFailureStage(input.error),
    });
  }

  recordStalePlaybackCommand(input: StalePlaybackDiagnostic): void {
    this.record('debug', 'playback.command.stale', {
      command: safeOperation(input.command),
      commandGeneration: safePositiveInteger(input.commandGeneration),
      currentGeneration: safePositiveInteger(input.currentGeneration),
      code: 'E_PLAYBACK_COMMAND_STALE',
    });
  }

  recordSegmentEndOvershoot(input: SegmentOvershootDiagnostic): void {
    if (!this.segmentOvershootEnabled) {
      return;
    }
    this.record('debug', 'playback.segment.overshoot', {
      projectId: safeIdentifier(input.projectId),
      segmentIndex: safeOptionalInteger(input.segmentIndex),
      commandGeneration: safePositiveInteger(input.commandGeneration),
      rate: Number.isFinite(input.rate) ? input.rate : 0,
      overshootMs: safeOptionalInteger(input.overshootMs),
    });
  }

  private terminalContext(input: ImportTerminalDiagnostic) {
    return {
      operationId: safeIdentifier(input.operationId),
      projectId: safeIdentifier(input.projectId),
      stage: input.stage,
    };
  }

  private record(
    level: 'debug' | 'info' | 'error',
    event: string,
    context: Readonly<Record<string, unknown>>,
  ): void {
    if (this.enabled) {
      this.log.record(level, event, context);
    }
  }
}

export const structuredDevelopmentDiagnostics = new StructuredDevelopmentDiagnostics();

import { requireNativeModule } from 'expo';

import {
  IMPORT_STAGES,
  TEMPO_LOOP_MEDIA_ERROR_CODES,
  type ImportMediaOptions,
  type ImportMediaResult,
  type ImportProgressEvent,
  type InspectMediaOptions,
  type TempoLoopMediaClient,
  type TempoLoopMediaErrorCode,
  type TempoLoopMediaNativeModule,
  type MediaInspection,
  type PickedMediaSource,
} from './TempoLoopMedia.types';

const MODULE_NAME = 'TempoLoopMedia';

type UnknownRecord = Record<string, unknown>;

export class TempoLoopMediaContractError extends Error {
  readonly code: TempoLoopMediaErrorCode;

  constructor(code: TempoLoopMediaErrorCode, message: string) {
    super(message);
    this.name = 'TempoLoopMediaContractError';
    this.code = code;
  }
}

function fail(code: TempoLoopMediaErrorCode, message: string): never {
  throw new TempoLoopMediaContractError(code, message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value);
}

function isNullableProgress(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
  );
}

function isSourceUri(value: unknown): value is string {
  return isNonEmptyString(value) && (value.startsWith('content://') || value.startsWith('file://'));
}

function isFileUri(value: unknown): value is string {
  return isNonEmptyString(value) && value.startsWith('file://');
}

function assertInspectMediaOptions(options: InspectMediaOptions): void {
  if (!isRecord(options)) {
    fail('E_UNKNOWN_NATIVE', 'Media inspection options must be an object.');
  }
  if (!isSourceUri(options.sourceUri)) {
    fail('E_SOURCE_UNREADABLE', 'The source must be a content:// or file:// URI.');
  }
  if (
    !isPositiveInteger(options.maxAudioSourceBytes) ||
    !isPositiveInteger(options.maxVideoSourceBytes)
  ) {
    fail('E_UNKNOWN_NATIVE', 'Media source size limits must be positive integers.');
  }
}

function assertImportMediaOptions(options: ImportMediaOptions): void {
  if (!isRecord(options)) {
    fail('E_UNKNOWN_NATIVE', 'Media import options must be an object.');
  }
  if (!isNonEmptyString(options.operationId)) {
    fail('E_UNKNOWN_NATIVE', 'The import operation ID must not be empty.');
  }
  if (!isSourceUri(options.sourceUri)) {
    fail('E_SOURCE_UNREADABLE', 'The source must be a content:// or file:// URI.');
  }
  if (!isFileUri(options.outputAudioUri)) {
    fail('E_PATH_OUTSIDE_APP', 'The output must be a file:// URI.');
  }
  if (!isPositiveInteger(options.waveformBinCount)) {
    fail('E_WAVEFORM_FAILED', 'The waveform bin count must be a positive integer.');
  }
  if (
    !isPositiveInteger(options.maxAudioSourceBytes) ||
    !isPositiveInteger(options.maxVideoSourceBytes)
  ) {
    fail('E_UNKNOWN_NATIVE', 'Media source size limits must be positive integers.');
  }
}

function assertOperationId(operationId: string): void {
  if (!isNonEmptyString(operationId)) {
    fail('E_UNKNOWN_NATIVE', 'The import operation ID must not be empty.');
  }
}

export function isTempoLoopMediaErrorCode(value: unknown): value is TempoLoopMediaErrorCode {
  return (
    typeof value === 'string' && (TEMPO_LOOP_MEDIA_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function assertPickedMediaSource(value: unknown): asserts value is PickedMediaSource {
  if (!isRecord(value) || !isSourceUri(value.uri)) {
    fail('E_SOURCE_UNREADABLE', 'Native gallery picker returned an invalid source URI.');
  }
  if (!(value.sizeBytes === null || isPositiveInteger(value.sizeBytes))) {
    fail('E_UNKNOWN_NATIVE', 'Native gallery picker returned an invalid source size.');
  }
  if (!(value.mimeType === null || isNonEmptyString(value.mimeType))) {
    fail('E_UNKNOWN_NATIVE', 'Native gallery picker returned an invalid MIME type.');
  }
  if (!(value.fileName === null || isNonEmptyString(value.fileName))) {
    fail('E_UNKNOWN_NATIVE', 'Native gallery picker returned an invalid display name.');
  }
}

export function assertMediaInspection(value: unknown): asserts value is MediaInspection {
  if (!isRecord(value)) {
    fail('E_UNKNOWN_NATIVE', 'Native media inspection returned a non-object value.');
  }
  if (value.sourceKind !== 'audio' && value.sourceKind !== 'video') {
    fail('E_UNKNOWN_NATIVE', 'Native media inspection returned an invalid source kind.');
  }
  if (!(value.sourceSizeBytes === null || isPositiveInteger(value.sourceSizeBytes))) {
    fail('E_UNKNOWN_NATIVE', 'Native video inspection returned an invalid source size.');
  }
  if (!isPositiveInteger(value.durationMs)) {
    fail('E_INVALID_DURATION', 'Native video inspection returned an invalid duration.');
  }
  if (!(
    value.audioMimeType === null ||
    (isNonEmptyString(value.audioMimeType) && value.audioMimeType.startsWith('audio/'))
  )) {
    fail('E_UNKNOWN_NATIVE', 'Native video inspection returned an invalid audio MIME type.');
  }
  if (!isNullablePositiveInteger(value.sampleRate)) {
    fail('E_UNKNOWN_NATIVE', 'Native video inspection returned an invalid sample rate.');
  }
  if (!isNullablePositiveInteger(value.channelCount)) {
    fail('E_UNKNOWN_NATIVE', 'Native video inspection returned an invalid channel count.');
  }
}

export function assertImportMediaResult(
  value: unknown,
  expectedWaveformBinCount: number,
): asserts value is ImportMediaResult {
  if (!isPositiveInteger(expectedWaveformBinCount)) {
    fail('E_WAVEFORM_FAILED', 'The expected waveform bin count must be a positive integer.');
  }
  if (!isRecord(value)) {
    fail('E_UNKNOWN_NATIVE', 'Native media import returned a non-object value.');
  }
  if (!isFileUri(value.audioUri)) {
    fail('E_OUTPUT_WRITE_FAILED', 'Native media import returned an invalid audio URI.');
  }
  if (!isPositiveInteger(value.audioSizeBytes)) {
    fail('E_EXPORT_EMPTY', 'Native media import returned an empty audio export.');
  }
  if (!isPositiveInteger(value.durationMs)) {
    fail('E_INVALID_DURATION', 'Native media import returned an invalid duration.');
  }
  if (!Array.isArray(value.waveform) || value.waveform.length !== expectedWaveformBinCount) {
    fail('E_WAVEFORM_FAILED', 'Native media import returned the wrong waveform length.');
  }
  if (
    !value.waveform.every(
      (sample) =>
        typeof sample === 'number' && Number.isFinite(sample) && sample >= 0 && sample <= 1,
    )
  ) {
    fail('E_WAVEFORM_FAILED', 'Native media import returned an invalid waveform sample.');
  }
}

export function assertImportProgressEvent(value: unknown): asserts value is ImportProgressEvent {
  if (!isRecord(value)) {
    fail('E_UNKNOWN_NATIVE', 'Native import progress returned a non-object value.');
  }
  if (!isNonEmptyString(value.operationId)) {
    fail('E_UNKNOWN_NATIVE', 'Native import progress returned an invalid operation ID.');
  }
  if (
    typeof value.stage !== 'string' ||
    !(IMPORT_STAGES as readonly string[]).includes(value.stage)
  ) {
    fail('E_UNKNOWN_NATIVE', 'Native import progress returned an invalid stage.');
  }
  if (!isNullableProgress(value.stageProgress)) {
    fail('E_UNKNOWN_NATIVE', 'Native import progress returned invalid stage progress.');
  }
  if (!isNullableProgress(value.overallProgress)) {
    fail('E_UNKNOWN_NATIVE', 'Native import progress returned invalid overall progress.');
  }
}

export function createTempoLoopMediaClient(
  getNativeModule: () => TempoLoopMediaNativeModule,
): TempoLoopMediaClient {
  return {
    async pickGalleryVideo() {
      const result: unknown = await getNativeModule().pickGalleryVideo();
      if (result === null) {
        return null;
      }
      assertPickedMediaSource(result);
      return result;
    },

    async inspectMedia(options) {
      assertInspectMediaOptions(options);
      const result: unknown = await getNativeModule().inspectMedia(options);
      assertMediaInspection(result);
      return result;
    },

    async importProjectMedia(options) {
      assertImportMediaOptions(options);
      const result: unknown = await getNativeModule().importProjectMedia(options);
      assertImportMediaResult(result, options.waveformBinCount);
      return result;
    },

    async cancelImport(operationId) {
      assertOperationId(operationId);
      await getNativeModule().cancelImport(operationId);
    },

    addImportProgressListener(listener) {
      if (typeof listener !== 'function') {
        fail('E_UNKNOWN_NATIVE', 'The import progress listener must be a function.');
      }

      return getNativeModule().addListener('onImportProgress', (event: unknown) => {
        assertImportProgressEvent(event);
        listener(event);
      });
    },
  };
}

let nativeModule: TempoLoopMediaNativeModule | undefined;

function requireTempoLoopMediaNativeModule(): TempoLoopMediaNativeModule {
  nativeModule ??= requireNativeModule<TempoLoopMediaNativeModule>(MODULE_NAME);
  return nativeModule;
}

/**
 * The custom module is resolved lazily so unit-tested services can receive an
 * injected client. Production calls still require TempoLoopMedia and never
 * fall back to a JavaScript implementation or optional native module.
 */
const TempoLoopMedia = createTempoLoopMediaClient(requireTempoLoopMediaNativeModule);

export default TempoLoopMedia;

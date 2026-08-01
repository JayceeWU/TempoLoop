export const IMPORT_STAGES = ['inspecting', 'exporting', 'waveform', 'finalizing'] as const;

export type ImportStage = (typeof IMPORT_STAGES)[number];

export const TEMPO_LOOP_MEDIA_ERROR_CODES = [
  'E_VIDEO_TOO_LARGE',
  'E_AUDIO_TOO_LARGE',
  'E_PICKER_UNAVAILABLE',
  'E_SOURCE_UNREADABLE',
  'E_NO_AUDIO_TRACK',
  'E_DRM_UNSUPPORTED',
  'E_INVALID_DURATION',
  'E_STORAGE_LOW',
  'E_IMPORT_BUSY',
  'E_IMPORT_CANCELLED',
  'E_UNSUPPORTED_MEDIA',
  'E_OUTPUT_WRITE_FAILED',
  'E_EXPORT_EMPTY',
  'E_WAVEFORM_FAILED',
  'E_INVALID_RANGE',
  'E_AUDIO_NOT_FOUND',
  'E_AUDIO_LOAD_FAILED',
  'E_PLAYBACK_COMMAND_STALE',
  'E_PATH_OUTSIDE_APP',
  'E_PROJECT_CORRUPT',
  'E_UNKNOWN_NATIVE',
] as const;

export type TempoLoopMediaErrorCode = (typeof TEMPO_LOOP_MEDIA_ERROR_CODES)[number];

export type SourceMediaKind = 'audio' | 'video';

export interface PickedMediaSource {
  uri: string;
  sizeBytes: number | null;
  mimeType: string | null;
  fileName: string | null;
}

export interface InspectMediaOptions {
  sourceUri: string;
  maxAudioSourceBytes: number;
  maxVideoSourceBytes: number;
}

export interface MediaInspection {
  sourceKind: SourceMediaKind;
  sourceSizeBytes: number | null;
  durationMs: number;
  audioMimeType: string | null;
  sampleRate: number | null;
  channelCount: number | null;
}

export interface ImportMediaOptions {
  operationId: string;
  sourceUri: string;
  outputAudioUri: string;
  waveformBinCount: number;
  maxAudioSourceBytes: number;
  maxVideoSourceBytes: number;
}

export interface ImportMediaResult {
  audioUri: string;
  audioSizeBytes: number;
  durationMs: number;
  waveform: number[];
}

export interface ImportProgressEvent {
  operationId: string;
  stage: ImportStage;
  stageProgress: number | null;
  overallProgress: number | null;
}

export interface TempoLoopMediaApi {
  pickGalleryVideo(): Promise<PickedMediaSource | null>;

  inspectMedia(options: InspectMediaOptions): Promise<MediaInspection>;

  importProjectMedia(options: ImportMediaOptions): Promise<ImportMediaResult>;

  cancelImport(operationId: string): Promise<void>;
}

export interface TempoLoopMediaSubscription {
  remove(): void;
}

export type ImportProgressListener = (event: ImportProgressEvent) => void;

export interface TempoLoopMediaClient extends TempoLoopMediaApi {
  addImportProgressListener(listener: ImportProgressListener): TempoLoopMediaSubscription;
}

/**
 * Native event values intentionally enter TypeScript as unknown and are
 * validated before being delivered to application listeners.
 */
export interface TempoLoopMediaNativeModule extends TempoLoopMediaApi {
  addListener(
    eventName: 'onImportProgress',
    listener: (event: unknown) => void,
  ): TempoLoopMediaSubscription;
}

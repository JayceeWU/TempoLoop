export const NATIVE_PLAYBACK_RATES = [1, 0.9, 0.8, 0.7] as const;

export type NativePlaybackRate = (typeof NATIVE_PLAYBACK_RATES)[number];

export const NATIVE_PLAYBACK_STATES = [
  'idle',
  'loading',
  'ready',
  'playing',
  'paused',
  'seeking',
  'completed',
  'failed',
] as const;

export type NativePlaybackState = (typeof NATIVE_PLAYBACK_STATES)[number];

export const NATIVE_ERROR_CODES = [
  'E_INVALID_URI',
  'E_FILE_NOT_FOUND',
  'E_NO_AUDIO_TRACK',
  'E_EXPORT_UNSUPPORTED',
  'E_EXPORT_FAILED',
  'E_WAVEFORM_FAILED',
  'E_INVALID_POINT_COUNT',
  'E_INVALID_RANGE',
  'E_AUDIO_NOT_LOADED',
  'E_SEEK_FAILED',
  'E_PLAYBACK_FAILED',
  'E_CANCELLED',
  'E_AUDIO_SESSION_FAILED',
  'E_INSUFFICIENT_STORAGE',
  'E_INTERNAL',
] as const;

export type NativeErrorCode = (typeof NATIVE_ERROR_CODES)[number];

export interface HealthCheckResult {
  available: true;
  apiVersion: 1;
}

export interface ExtractAudioResult {
  durationMs: number;
  outputBytes: number;
}

export interface PlaybackSnapshot {
  state: NativePlaybackState;
  currentTimeMs: number;
  durationMs: number;
  rate: NativePlaybackRate;
  activeRangeStartMs: number | null;
  activeRangeEndMs: number | null;
}

export type ImportProgressPhase = 'extracting' | 'waveform';

export interface ImportProgressEvent {
  taskId: string;
  phase: ImportProgressPhase;
  /**
   * A finite value clamped to the inclusive range from 0 through 1.
   */
  progress: number;
}

export type PlaybackChangeReason =
  'user' | 'range-ended' | 'interruption' | 'route-changed' | 'app-inactive' | 'error';

export interface PlaybackEvent extends PlaybackSnapshot {
  /**
   * Monotonic native command identifier. Production iOS events always include
   * it; optionality keeps injected and legacy test emitters compatible.
   */
  commandGeneration?: number;
  reason?: PlaybackChangeReason;
}

export type DanceAudioEvents = {
  onImportProgress: (event: ImportProgressEvent) => void;
  onPlaybackChanged: (event: PlaybackEvent) => void;
};

/**
 * The serializable async surface implemented by the Apple-only DanceAudio
 * native module. Event subscriptions are supplied by Expo's NativeModule base
 * class and are strongly typed by {@link DanceAudioEvents}.
 */
export interface DanceAudioModuleContract {
  healthCheck(): Promise<HealthCheckResult>;

  extractAudio(
    taskId: string,
    inputVideoUri: string,
    outputAudioUri: string,
  ): Promise<ExtractAudioResult>;

  generateWaveform(taskId: string, audioUri: string, pointCount: number): Promise<number[]>;

  cancelTask(taskId: string): Promise<void>;

  loadAudio(audioUri: string): Promise<PlaybackSnapshot>;

  playRange(startMs: number, endMs: number, rate: NativePlaybackRate): Promise<PlaybackSnapshot>;

  playFrom(positionMs: number, rate: NativePlaybackRate): Promise<PlaybackSnapshot>;

  pause(): Promise<PlaybackSnapshot>;

  resume(): Promise<PlaybackSnapshot>;

  seek(positionMs: number): Promise<PlaybackSnapshot>;

  setRate(rate: NativePlaybackRate): Promise<PlaybackSnapshot>;

  stopAndSeek(positionMs: number): Promise<PlaybackSnapshot>;

  getPlaybackSnapshot(): Promise<PlaybackSnapshot>;

  unload(): Promise<void>;
}

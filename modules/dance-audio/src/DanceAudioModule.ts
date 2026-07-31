import { NativeModule, requireNativeModule } from 'expo';

import type {
  DanceAudioEvents,
  DanceAudioModuleContract,
  ExtractAudioResult,
  HealthCheckResult,
  NativePlaybackRate,
  PlaybackSnapshot,
} from './DanceAudio.types';

export declare class DanceAudioNativeModule
  extends NativeModule<DanceAudioEvents>
  implements DanceAudioModuleContract
{
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

/**
 * Intentionally throws during module evaluation when the custom iOS module is
 * absent. TempoLoop requires a development or preview build and must never
 * silently fall back to a JavaScript or Expo Go implementation.
 */
export default requireNativeModule<DanceAudioNativeModule>('DanceAudio');

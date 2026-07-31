import { requireNativeModule } from 'expo';

import type {
  DanceAudioEvents,
  DanceAudioModuleContract,
  DanceAudioNativeModule,
  ExtractAudioResult,
  HealthCheckResult,
  ImportProgressEvent,
  NativePlaybackRate,
  PlaybackEvent,
  PlaybackSnapshot,
} from '../../modules/dance-audio';
import { developmentDiagnosticState } from '@/services/DevelopmentDiagnosticState';
import { toAppError } from '@/utils/errors';

export interface NativeAudioSubscription {
  remove(): void;
}

/**
 * The narrow dependency consumed by the app service. A real Expo NativeModule
 * satisfies this interface, while Jest can inject a small typed test double.
 */
export interface NativeAudioModuleDependency extends DanceAudioModuleContract {
  addListener<EventName extends keyof DanceAudioEvents>(
    eventName: EventName,
    listener: DanceAudioEvents[EventName],
  ): NativeAudioSubscription;
}

export class NativeAudioService implements DanceAudioModuleContract {
  private resolvedModule: NativeAudioModuleDependency | null = null;

  constructor(private readonly injectedModule?: NativeAudioModuleDependency) {}

  healthCheck(): Promise<HealthCheckResult> {
    return this.invoke('healthCheck', (module) => module.healthCheck());
  }

  extractAudio(
    taskId: string,
    inputVideoUri: string,
    outputAudioUri: string,
  ): Promise<ExtractAudioResult> {
    return this.invoke('extractAudio', (module) =>
      module.extractAudio(taskId, inputVideoUri, outputAudioUri),
    );
  }

  generateWaveform(taskId: string, audioUri: string, pointCount: number): Promise<number[]> {
    return this.invoke('generateWaveform', (module) =>
      module.generateWaveform(taskId, audioUri, pointCount),
    );
  }

  cancelTask(taskId: string): Promise<void> {
    return this.invoke('cancelTask', (module) => module.cancelTask(taskId));
  }

  loadAudio(audioUri: string): Promise<PlaybackSnapshot> {
    return this.invoke('loadAudio', (module) => module.loadAudio(audioUri));
  }

  playRange(startMs: number, endMs: number, rate: NativePlaybackRate): Promise<PlaybackSnapshot> {
    return this.invoke('playRange', (module) => module.playRange(startMs, endMs, rate));
  }

  playFrom(positionMs: number, rate: NativePlaybackRate): Promise<PlaybackSnapshot> {
    return this.invoke('playFrom', (module) => module.playFrom(positionMs, rate));
  }

  pause(): Promise<PlaybackSnapshot> {
    return this.invoke('pause', (module) => module.pause());
  }

  resume(): Promise<PlaybackSnapshot> {
    return this.invoke('resume', (module) => module.resume());
  }

  seek(positionMs: number): Promise<PlaybackSnapshot> {
    return this.invoke('seek', (module) => module.seek(positionMs));
  }

  setRate(rate: NativePlaybackRate): Promise<PlaybackSnapshot> {
    return this.invoke('setRate', (module) => module.setRate(rate));
  }

  stopAndSeek(positionMs: number): Promise<PlaybackSnapshot> {
    return this.invoke('stopAndSeek', (module) => module.stopAndSeek(positionMs));
  }

  getPlaybackSnapshot(): Promise<PlaybackSnapshot> {
    return this.invoke('getPlaybackSnapshot', (module) => module.getPlaybackSnapshot());
  }

  unload(): Promise<void> {
    return this.invoke('unload', (module) => module.unload());
  }

  addImportProgressListener(
    listener: (event: ImportProgressEvent) => void,
  ): NativeAudioSubscription {
    return this.addListener('onImportProgress', listener);
  }

  addPlaybackChangedListener(listener: (event: PlaybackEvent) => void): NativeAudioSubscription {
    return this.addListener('onPlaybackChanged', listener);
  }

  private getModule(): NativeAudioModuleDependency {
    if (this.injectedModule !== undefined) {
      return this.injectedModule;
    }

    if (this.resolvedModule === null) {
      this.resolvedModule = requireNativeModule<DanceAudioNativeModule>('DanceAudio');
    }

    return this.resolvedModule;
  }

  private async invoke<Result>(
    operationName: string,
    operation: (module: NativeAudioModuleDependency) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await operation(this.getModule());
    } catch (error) {
      const appError = toAppError(error);
      developmentDiagnosticState.recordNativeError(appError, operationName);
      throw appError;
    }
  }

  private addListener<EventName extends keyof DanceAudioEvents>(
    eventName: EventName,
    listener: DanceAudioEvents[EventName],
  ): NativeAudioSubscription {
    try {
      return this.getModule().addListener(eventName, listener);
    } catch (error) {
      const appError = toAppError(error);
      developmentDiagnosticState.recordNativeError(appError, `addListener:${String(eventName)}`);
      throw appError;
    }
  }
}

/**
 * Resolves the required custom module only when first used. This keeps unit
 * tests injectable without adding a runtime fallback when DanceAudio is absent.
 */
export const nativeAudioService = new NativeAudioService();

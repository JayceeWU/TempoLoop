import type { AudioStatus } from 'expo-audio';

import {
  getSharedAudioPlayer,
  prepareSharedAudioPlayerForImport,
} from '@/playback/SharedAudioPlayerRegistry';
import { TempoLoopMediaServiceError } from '@/services/TempoLoopMediaService';

const DEFAULT_LOAD_TIMEOUT_MS = 8_000;

export interface AudioStatusSubscription {
  remove(): void;
}

export interface AudioLoadValidationPlayer {
  readonly currentStatus: AudioStatus;
  pause(): void;
  replace(source: string | null): void;
  addListener(
    eventName: 'playbackStatusUpdate',
    listener: (status: AudioStatus) => void,
  ): AudioStatusSubscription;
  remove(): void;
}

export interface PartialAudioValidator {
  validateLoadable(audioUri: string): Promise<void>;
  clearSource(audioUri?: string): void;
}

export interface ExpoAudioPartialValidatorOptions {
  readonly createPlayer?: () => AudioLoadValidationPlayer | Promise<AudioLoadValidationPlayer>;
  readonly timeoutMs?: number;
  readonly removePlayerOnDispose?: boolean;
}

function validationError(message: string, cause?: unknown): TempoLoopMediaServiceError {
  return new TempoLoopMediaServiceError('E_AUDIO_LOAD_FAILED', message, cause);
}

function assertPrivateFileUri(uri: string): void {
  if (!uri.startsWith('file://') || uri.length <= 'file://'.length) {
    throw validationError('The exported audio URI is not a local file URI.');
  }
}

async function createProductionPlayer(): Promise<AudioLoadValidationPlayer> {
  return getSharedAudioPlayer();
}

/**
 * A single long-lived expo-audio player validates each native partial export.
 * It never reads media bytes in JavaScript and always clears the source after
 * validation so repository finalization can rename the import directory.
 */
export class ExpoAudioPartialValidator implements PartialAudioValidator {
  private readonly createPlayer: () =>
    AudioLoadValidationPlayer | Promise<AudioLoadValidationPlayer>;
  private readonly timeoutMs: number;
  private readonly removePlayerOnDispose: boolean;
  private player: AudioLoadValidationPlayer | null = null;
  private playerPromise: Promise<AudioLoadValidationPlayer> | null = null;
  private activeUri: string | null = null;
  private abortActiveValidation: (() => void) | null = null;
  private validationGeneration = 0;

  constructor(options: ExpoAudioPartialValidatorOptions = {}) {
    this.createPlayer = options.createPlayer ?? createProductionPlayer;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
    this.removePlayerOnDispose =
      options.removePlayerOnDispose ?? options.createPlayer !== undefined;
  }

  async validateLoadable(audioUri: string): Promise<void> {
    assertPrivateFileUri(audioUri);
    if (this.activeUri !== null) {
      throw validationError('Another audio source is already being validated.');
    }

    const generation = ++this.validationGeneration;
    this.activeUri = audioUri;

    try {
      try {
        prepareSharedAudioPlayerForImport();
      } catch (error) {
        throw validationError(
          'TempoLoop could not prepare the shared audio player for import validation.',
          error,
        );
      }
      const player = await this.getPlayer();
      if (generation !== this.validationGeneration || this.activeUri !== audioUri) {
        throw validationError('Audio validation was cancelled.');
      }
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let subscription: AudioStatusSubscription | null = null;
        const finish = (error?: TempoLoopMediaServiceError) => {
          if (settled || generation !== this.validationGeneration) {
            return;
          }
          settled = true;
          this.abortActiveValidation = null;
          clearTimeout(timeout);
          subscription?.remove();
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        };
        const inspectStatus = (status: AudioStatus) => {
          if (status.error !== null) {
            finish(validationError('expo-audio could not load the exported audio.'));
            return;
          }
          if (status.isLoaded && Number.isFinite(status.duration) && status.duration > 0) {
            finish();
          }
        };
        const timeout = setTimeout(() => {
          finish(validationError('expo-audio timed out while loading the exported audio.'));
        }, this.timeoutMs);
        this.abortActiveValidation = () => {
          finish(validationError('Audio validation was cancelled.'));
        };

        try {
          subscription = player.addListener('playbackStatusUpdate', inspectStatus);
          player.pause();
          player.replace(audioUri);
          // Do not inspect currentStatus here. The shared singleton may still
          // expose the previously loaded Project for a short time after
          // replace(), so only a post-replace playbackStatusUpdate can prove
          // that this partial file was decoded successfully.
        } catch (error) {
          finish(validationError('expo-audio rejected the exported audio source.', error));
        }
      });
    } finally {
      if (generation === this.validationGeneration) {
        this.clearSource(audioUri);
      }
    }
  }

  clearSource(audioUri?: string): void {
    if (audioUri !== undefined && this.activeUri !== null && this.activeUri !== audioUri) {
      return;
    }
    this.abortActiveValidation?.();
    this.abortActiveValidation = null;
    this.validationGeneration += 1;
    this.activeUri = null;
    if (this.player !== null) {
      try {
        this.player.pause();
        this.player.replace(null);
      } catch {
        // Source clearing is best-effort; the generation still invalidates it.
      }
    }
  }

  dispose(): void {
    this.clearSource();
    if (this.removePlayerOnDispose) {
      this.player?.remove();
    }
    this.player = null;
  }

  private async getPlayer(): Promise<AudioLoadValidationPlayer> {
    if (this.player !== null) {
      return this.player;
    }
    this.playerPromise ??= Promise.resolve(this.createPlayer());
    try {
      this.player = await this.playerPromise;
      return this.player;
    } catch (error) {
      throw validationError('expo-audio could not create the validation player.', error);
    } finally {
      this.playerPromise = null;
    }
  }
}

export const partialAudioValidator = new ExpoAudioPartialValidator();

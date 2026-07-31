import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef } from 'react';

import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { type AppError, toAppError } from '@/utils/errors';

export const PLAYBACK_KEEP_AWAKE_TAG = 'TempoLoopPlayback';

export interface PlaybackKeepAwakeDependency {
  activate(tag: string): Promise<void>;
  deactivate(tag: string): Promise<void>;
}

const expoKeepAwake: PlaybackKeepAwakeDependency = {
  activate: (tag) => activateKeepAwakeAsync(tag),
  deactivate: (tag) => deactivateKeepAwake(tag),
};

function reportKeepAwakeError(error: unknown, onError: (error: AppError) => void): void {
  try {
    onError(toAppError(error));
  } catch {
    // Keep-awake cleanup must never fail the playback flow.
  }
}

/**
 * Activates one uniquely tagged keep-awake lease and safely releases it even
 * when cleanup wins a race with the asynchronous activation.
 */
export function activatePlaybackKeepAwake(
  keepAwake: PlaybackKeepAwakeDependency,
  tag: string,
  onError: (error: AppError) => void,
): () => void {
  let shouldRelease = false;
  let didActivate = false;

  void keepAwake
    .activate(tag)
    .then(() => {
      didActivate = true;
      if (shouldRelease) {
        return keepAwake.deactivate(tag);
      }
      return undefined;
    })
    .catch((error: unknown) => {
      reportKeepAwakeError(error, onError);
    });

  return () => {
    shouldRelease = true;
    if (didActivate) {
      void keepAwake
        .deactivate(tag)
        .catch((error: unknown) => reportKeepAwakeError(error, onError));
    }
  };
}

export interface UsePlaybackKeepAwakeOptions {
  readonly isPlaying?: boolean;
  readonly keepAwake?: PlaybackKeepAwakeDependency;
  readonly onError?: (error: AppError) => void;
  readonly tag?: string;
}

/**
 * Holds a keep-awake lease only while the latest native snapshot is playing.
 */
export function usePlaybackKeepAwake(options: UsePlaybackKeepAwakeOptions = {}): void {
  const nativeIsPlaying = usePlaybackStore((state) => state.snapshot.state === 'playing');
  const recordError = usePlaybackStore((state) => state.recordError);
  const leaseSequence = useRef(0);
  const isPlaying = options.isPlaying ?? nativeIsPlaying;
  const keepAwake = options.keepAwake ?? expoKeepAwake;
  const onError = options.onError ?? recordError;
  const baseTag = options.tag ?? PLAYBACK_KEEP_AWAKE_TAG;

  useEffect(() => {
    if (!isPlaying) {
      return undefined;
    }

    leaseSequence.current += 1;
    const leaseTag = `${baseTag}:${leaseSequence.current}`;
    return activatePlaybackKeepAwake(keepAwake, leaseTag, onError);
  }, [baseTag, isPlaying, keepAwake, onError]);
}

import { useEffect } from 'react';

import type { PlaybackEvent } from '../../modules/dance-audio';
import { nativeAudioService, type NativeAudioSubscription } from '@/services/NativeAudioService';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { type AppError, toAppError } from '@/utils/errors';

export interface PlaybackEventSource {
  addPlaybackChangedListener(listener: (event: PlaybackEvent) => void): NativeAudioSubscription;
}

function reportSubscriptionError(error: unknown, onError: (error: AppError) => void): void {
  try {
    onError(toAppError(error));
  } catch {
    // Native event delivery must not be allowed to throw into Expo's emitter.
  }
}

/**
 * Subscribes to native player state without assuming React is still mounted
 * when an already-queued event is delivered.
 */
export function subscribeToNativePlaybackEvents(
  source: PlaybackEventSource,
  onEvent: (event: PlaybackEvent) => void,
  onError: (error: AppError) => void,
): () => void {
  let isActive = true;
  let subscription: NativeAudioSubscription;

  try {
    subscription = source.addPlaybackChangedListener((event) => {
      if (!isActive) {
        return;
      }

      try {
        onEvent(event);
      } catch (error) {
        reportSubscriptionError(error, onError);
      }
    });
  } catch (error) {
    reportSubscriptionError(error, onError);
    return () => {
      isActive = false;
    };
  }

  return () => {
    isActive = false;
    try {
      subscription.remove();
    } catch {
      // Cleanup is best effort. The active guard still drops queued events.
    }
  };
}

export interface UseNativePlaybackEventsOptions {
  readonly source?: PlaybackEventSource;
  readonly onEvent?: (event: PlaybackEvent) => void;
  readonly onError?: (error: AppError) => void;
}

/**
 * Keeps the global playback store synchronized with the native AVPlayer.
 *
 * No local clock is started here: native events remain the sole source of
 * current playback time and state.
 */
export function useNativePlaybackEvents(options: UseNativePlaybackEventsOptions = {}): void {
  const receiveNativeEvent = usePlaybackStore((state) => state.receiveNativeEvent);
  const recordError = usePlaybackStore((state) => state.recordError);
  const source = options.source ?? nativeAudioService;
  const onEvent = options.onEvent ?? receiveNativeEvent;
  const onError = options.onError ?? recordError;

  useEffect(
    () => subscribeToNativePlaybackEvents(source, onEvent, onError),
    [onError, onEvent, source],
  );
}

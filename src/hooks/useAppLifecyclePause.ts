import { useEffect } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import type { NativePlaybackState, PlaybackSnapshot } from '../../modules/dance-audio';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { type AppError, toAppError } from '@/utils/errors';

export interface AppStateDependency {
  readonly currentState: AppStateStatus | null;
  addEventListener(
    type: 'change',
    listener: (state: AppStateStatus) => void,
  ): NativeEventSubscription;
}

export type LifecyclePause = () => Promise<PlaybackSnapshot | void>;

export function shouldPauseForPlaybackState(state: NativePlaybackState): boolean {
  return state !== 'idle' && state !== 'failed';
}

function shouldPauseLoadedPlayback(): boolean {
  return shouldPauseForPlaybackState(usePlaybackStore.getState().snapshot.state);
}

function reportPauseError(error: unknown, onError: (error: AppError) => void): void {
  try {
    onError(toAppError(error));
  } catch {
    // A reporting callback cannot be allowed to create an unhandled rejection.
  }
}

/**
 * Calls pause exactly when the app leaves the active state. Returning to
 * active only updates the transition tracker and never resumes playback.
 */
export function subscribeToAppLifecyclePause(
  appState: AppStateDependency,
  pause: LifecyclePause,
  onError: (error: AppError) => void,
  shouldPause: () => boolean = () => true,
): () => void {
  let previousState = appState.currentState;
  let isActive = true;

  const subscription = appState.addEventListener('change', (nextState) => {
    const leftActive = previousState === 'active' && nextState !== 'active';
    previousState = nextState;

    if (!leftActive || !isActive) {
      return;
    }

    try {
      if (!shouldPause()) {
        return;
      }

      void pause().catch((error: unknown) => {
        if (isActive) {
          reportPauseError(error, onError);
        }
      });
    } catch (error) {
      reportPauseError(error, onError);
    }
  });

  return () => {
    isActive = false;
    try {
      subscription.remove();
    } catch {
      // The inactive guard prevents queued AppState callbacks from acting.
    }
  };
}

export interface UseAppLifecyclePauseOptions {
  readonly appState?: AppStateDependency;
  readonly pause?: LifecyclePause;
  readonly onError?: (error: AppError) => void;
  readonly shouldPause?: () => boolean;
}

export function useAppLifecyclePause(options: UseAppLifecyclePauseOptions = {}): void {
  const pausePlayback = usePlaybackStore((state) => state.pause);
  const recordError = usePlaybackStore((state) => state.recordError);
  const appState = options.appState ?? AppState;
  const pause = options.pause ?? pausePlayback;
  const onError = options.onError ?? recordError;
  const shouldPause = options.shouldPause ?? shouldPauseLoadedPlayback;

  useEffect(
    () => subscribeToAppLifecyclePause(appState, pause, onError, shouldPause),
    [appState, onError, pause, shouldPause],
  );
}

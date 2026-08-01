import {
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';

import type { PlaybackRate, PlaybackSnapshot } from '@/domain/playback';
import {
  PlaybackCoordinator,
  type TempoLoopAudioStatus,
  type TempoLoopPlayerPort,
} from '@/playback/PlaybackCoordinator';
import { registerProjectPlaybackSourceClearer } from '@/playback/PlaybackSourceLifecycle';
import {
  registerImportPlaybackPreparation,
  registerSharedAudioPlayer,
} from '@/playback/SharedAudioPlayerRegistry';

export const AUDIO_STATUS_INTERVAL_MS = 50;
export const PLAYER_KEEP_AWAKE_TAG = 'TempoLoopPlayer';

const PlaybackCoordinatorContext = createContext<PlaybackCoordinator | null>(null);

function toCoordinatorStatus(status: AudioStatus): TempoLoopAudioStatus {
  return {
    currentTime: status.currentTime,
    duration: status.duration,
    playing: status.playing,
    didJustFinish: status.didJustFinish,
    isLoaded: status.isLoaded,
    isBuffering: status.isBuffering,
    playbackRate: status.playbackRate,
    error: status.error,
  };
}

function createPlayerPort(player: AudioPlayer): TempoLoopPlayerPort {
  return {
    pause: () => player.pause(),
    play: () => player.play(),
    replace: (sourceUri) => player.replace(sourceUri === null ? null : { uri: sourceUri }),
    seekTo: (positionSeconds) => player.seekTo(positionSeconds),
    setRate: (rate: PlaybackRate) => {
      player.shouldCorrectPitch = true;
      player.setPlaybackRate(rate, 'high');
    },
  };
}

function useCoordinatorSnapshot(coordinator: PlaybackCoordinator): PlaybackSnapshot {
  return useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
}

export function AudioPlayerProvider({ children }: PropsWithChildren) {
  const player = useAudioPlayer(null, {
    downloadFirst: false,
    updateInterval: AUDIO_STATUS_INTERVAL_MS,
  });
  const nativeStatus = useAudioPlayerStatus(player);
  const coordinator = useMemo(() => new PlaybackCoordinator(createPlayerPort(player)), [player]);
  const snapshot = useCoordinatorSnapshot(coordinator);

  useEffect(() => {
    const unregisterPlayer = registerSharedAudioPlayer(player);
    const unregisterImportPreparation = registerImportPlaybackPreparation(() => {
      coordinator.clearSource();
    });
    const unregisterProjectClearer = registerProjectPlaybackSourceClearer(async (projectId) => {
      coordinator.clearSource(projectId);
    });

    return () => {
      unregisterProjectClearer();
      unregisterImportPreparation();
      unregisterPlayer();
    };
  }, [coordinator, player]);

  useEffect(() => {
    void setAudioModeAsync({
      allowsBackgroundRecording: false,
      allowsRecording: false,
      interruptionMode: 'doNotMix',
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {
      // A screen command will surface a player failure if audio is unavailable.
    });
  }, [player]);

  useEffect(() => {
    coordinator.handleNativeStatus(toCoordinatorStatus(nativeStatus));
  }, [coordinator, nativeStatus]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const leftForeground = previousState === 'active' && nextState !== 'active';
      const enteredForeground = previousState !== 'active' && nextState === 'active';
      previousState = nextState;

      if (leftForeground) {
        coordinator.pause();
        void setIsAudioActiveAsync(false).catch(() => {
          // Playback is already paused; lifecycle cleanup remains best effort.
        });
      } else if (enteredForeground) {
        void setIsAudioActiveAsync(true).catch(() => {
          // A later explicit play command reports activation failures.
        });
      }
    });

    return () => subscription.remove();
  }, [coordinator]);

  useEffect(() => {
    if (snapshot.status !== 'playing') {
      return undefined;
    }

    let released = false;
    void activateKeepAwakeAsync(PLAYER_KEEP_AWAKE_TAG)
      .then(() => {
        if (released) {
          return deactivateKeepAwake(PLAYER_KEEP_AWAKE_TAG);
        }
        return undefined;
      })
      .catch(() => {
        // Keep-awake failure must not interrupt audio playback.
      });

    return () => {
      released = true;
      void deactivateKeepAwake(PLAYER_KEEP_AWAKE_TAG).catch(() => {
        // The tagged lease may already have been released by Android.
      });
    };
  }, [snapshot.status]);

  useEffect(
    () => () => {
      coordinator.dispose();
    },
    [coordinator],
  );

  return (
    <PlaybackCoordinatorContext.Provider value={coordinator}>
      {children}
    </PlaybackCoordinatorContext.Provider>
  );
}

export function usePlaybackCoordinator(): PlaybackCoordinator {
  const coordinator = useContext(PlaybackCoordinatorContext);
  if (coordinator === null) {
    throw new Error('usePlaybackCoordinator must be used inside AudioPlayerProvider.');
  }
  return coordinator;
}

export function usePlaybackSnapshot(): PlaybackSnapshot {
  return useCoordinatorSnapshot(usePlaybackCoordinator());
}

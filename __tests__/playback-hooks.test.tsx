import { renderHook } from '@testing-library/react-native';
import type { AppStateStatus } from 'react-native';

import type { PlaybackEvent } from '../modules/dance-audio';
import {
  subscribeToAppLifecyclePause,
  shouldPauseForPlaybackState,
  type AppStateDependency,
} from '@/hooks/useAppLifecyclePause';
import {
  subscribeToNativePlaybackEvents,
  type PlaybackEventSource,
} from '@/hooks/useNativePlaybackEvents';
import {
  activatePlaybackKeepAwake,
  usePlaybackKeepAwake,
  type PlaybackKeepAwakeDependency,
} from '@/hooks/usePlaybackKeepAwake';
import type { NativeAudioSubscription } from '@/services/NativeAudioService';
import { AppError } from '@/utils/errors';

const PLAYBACK_EVENT: PlaybackEvent = {
  state: 'playing',
  currentTimeMs: 4_000,
  durationMs: 90_000,
  rate: 0.8,
  activeRangeStartMs: 4_000,
  activeRangeEndMs: 12_000,
};

function flushPromises(): Promise<void> {
  return Promise.resolve();
}

describe('native playback event subscription', () => {
  it('forwards events while active, removes the subscription, and drops queued events', () => {
    const listenerRef: {
      current?: (event: PlaybackEvent) => void;
    } = {};
    const remove = jest.fn();
    const source: PlaybackEventSource = {
      addPlaybackChangedListener: (nextListener) => {
        listenerRef.current = nextListener;
        return { remove };
      },
    };
    const onEvent = jest.fn();
    const onError = jest.fn();

    const cleanup = subscribeToNativePlaybackEvents(source, onEvent, onError);
    listenerRef.current?.(PLAYBACK_EVENT);
    cleanup();
    listenerRef.current?.({
      ...PLAYBACK_EVENT,
      currentTimeMs: 5_000,
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(PLAYBACK_EVENT);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('maps subscription and listener failures without throwing into the emitter', () => {
    const onError = jest.fn();
    const subscriptionFailure: PlaybackEventSource = {
      addPlaybackChangedListener: () => {
        throw Object.assign(new Error('Emitter unavailable'), {
          code: 'E_INTERNAL',
        });
      },
    };

    expect(() =>
      subscribeToNativePlaybackEvents(subscriptionFailure, jest.fn(), onError),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'AppError',
        code: 'E_INTERNAL',
      }),
    );

    const listenerRef: {
      current?: (event: PlaybackEvent) => void;
    } = {};
    const source: PlaybackEventSource = {
      addPlaybackChangedListener: (nextListener) => {
        listenerRef.current = nextListener;
        return {
          remove: jest.fn(),
        } satisfies NativeAudioSubscription;
      },
    };
    const listenerError = jest.fn();
    subscribeToNativePlaybackEvents(
      source,
      () => {
        throw new Error('Store rejected event');
      },
      listenerError,
    );

    expect(() => listenerRef.current?.(PLAYBACK_EVENT)).not.toThrow();
    expect(listenerError).toHaveBeenCalledWith(expect.any(AppError));
  });
});

describe('app lifecycle pause subscription', () => {
  it('pauses only when leaving active and never resumes on activation', async () => {
    let currentState: AppStateStatus | null = 'active';
    const listenerRef: {
      current?: (state: AppStateStatus) => void;
    } = {};
    const remove = jest.fn();
    const appState: AppStateDependency = {
      get currentState() {
        return currentState;
      },
      addEventListener: (_type, nextListener) => {
        listenerRef.current = nextListener;
        return { remove };
      },
    };
    const pause = jest.fn(async () => undefined);
    const onError = jest.fn();
    const cleanup = subscribeToAppLifecyclePause(appState, pause, onError);

    listenerRef.current?.('inactive');
    currentState = 'inactive';
    listenerRef.current?.('background');
    currentState = 'background';
    listenerRef.current?.('active');
    currentState = 'active';

    expect(pause).toHaveBeenCalledTimes(1);

    listenerRef.current?.('background');
    await flushPromises();
    expect(pause).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();

    cleanup();
    listenerRef.current?.('active');
    listenerRef.current?.('background');
    expect(pause).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('handles an asynchronous pause rejection without an unhandled rejection', async () => {
    const listenerRef: {
      current?: (state: AppStateStatus) => void;
    } = {};
    const appState: AppStateDependency = {
      currentState: 'active',
      addEventListener: (_type, nextListener) => {
        listenerRef.current = nextListener;
        return { remove: jest.fn() };
      },
    };
    const onError = jest.fn();
    subscribeToAppLifecyclePause(
      appState,
      async () => {
        throw Object.assign(new Error('Pause failed'), {
          code: 'E_PLAYBACK_FAILED',
        });
      },
      onError,
    );

    listenerRef.current?.('background');
    await flushPromises();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'E_PLAYBACK_FAILED',
      }),
    );
  });

  it('does not call native pause from idle, but pauses every loaded state', () => {
    const listenerRef: {
      current?: (state: AppStateStatus) => void;
    } = {};
    let playbackState: 'idle' | 'ready' = 'idle';
    const appState: AppStateDependency = {
      currentState: 'active',
      addEventListener: (_type, nextListener) => {
        listenerRef.current = nextListener;
        return { remove: jest.fn() };
      },
    };
    const pause = jest.fn(async () => undefined);
    subscribeToAppLifecyclePause(appState, pause, jest.fn(), () =>
      shouldPauseForPlaybackState(playbackState),
    );

    listenerRef.current?.('background');
    expect(pause).not.toHaveBeenCalled();

    listenerRef.current?.('active');
    playbackState = 'ready';
    listenerRef.current?.('inactive');
    expect(pause).toHaveBeenCalledTimes(1);
  });
});

describe('playback keep-awake', () => {
  it('releases an activation that resolves after cleanup', async () => {
    let resolveActivation!: () => void;
    const activation = new Promise<void>((resolve) => {
      resolveActivation = resolve;
    });
    const keepAwake: PlaybackKeepAwakeDependency = {
      activate: jest.fn(() => activation),
      deactivate: jest.fn(async () => undefined),
    };
    const onError = jest.fn();

    const cleanup = activatePlaybackKeepAwake(keepAwake, 'TempoLoopPlayback:test', onError);
    cleanup();
    resolveActivation();
    await flushPromises();
    await flushPromises();

    expect(keepAwake.deactivate).toHaveBeenCalledWith('TempoLoopPlayback:test');
    expect(onError).not.toHaveBeenCalled();
  });

  it('activates only while the native state is playing', async () => {
    const keepAwake: PlaybackKeepAwakeDependency = {
      activate: jest.fn(async () => undefined),
      deactivate: jest.fn(async () => undefined),
    };
    const onError = jest.fn();
    const { rerender, unmount } = await renderHook(
      ({ isPlaying }: { isPlaying: boolean }) =>
        usePlaybackKeepAwake({
          isPlaying,
          keepAwake,
          onError,
          tag: 'PlaybackTest',
        }),
      {
        initialProps: { isPlaying: false },
      },
    );

    expect(keepAwake.activate).not.toHaveBeenCalled();

    await rerender({ isPlaying: true });
    await flushPromises();
    expect(keepAwake.activate).toHaveBeenCalledWith('PlaybackTest:1');

    await rerender({ isPlaying: false });
    await flushPromises();
    expect(keepAwake.deactivate).toHaveBeenCalledWith('PlaybackTest:1');

    await unmount();
    expect(onError).not.toHaveBeenCalled();
  });
});

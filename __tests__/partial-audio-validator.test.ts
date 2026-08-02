import type { AudioPlayer, AudioStatus } from 'expo-audio';

import {
  registerImportPlaybackPreparation,
  registerSharedAudioPlayer,
} from '@/playback/SharedAudioPlayerRegistry';
import {
  ExpoAudioPartialValidator,
  type AudioLoadValidationPlayer,
} from '@/services/PartialAudioValidator';

function status(overrides: Partial<AudioStatus> = {}): AudioStatus {
  return {
    id: 'player-1',
    currentTime: 0,
    playbackState: 'idle',
    timeControlStatus: 'paused',
    reasonForWaitingToPlay: '',
    mute: false,
    duration: 0,
    playing: false,
    loop: false,
    didJustFinish: false,
    isBuffering: false,
    isLoaded: false,
    playbackRate: 1,
    shouldCorrectPitch: true,
    isLive: false,
    currentOffsetFromLive: null,
    error: null,
    ...overrides,
  };
}

function createPlayer(
  onReplace: (source: string | null, emit: (value: AudioStatus) => void) => void,
) {
  let listener: ((value: AudioStatus) => void) | null = null;
  const player: AudioLoadValidationPlayer = {
    currentStatus: status(),
    pause: jest.fn(),
    replace: jest.fn((source) => onReplace(source, (value) => listener?.(value))),
    addListener: jest.fn((_name, nextListener) => {
      listener = nextListener;
      return { remove: jest.fn(() => (listener = null)) };
    }),
    remove: jest.fn(),
  };
  return player;
}

async function waitForListeners(
  listeners: ReadonlyArray<(value: AudioStatus) => void>,
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 10 && listeners.length < count; attempt += 1) {
    await Promise.resolve();
  }
  expect(listeners).toHaveLength(count);
}

describe('ExpoAudioPartialValidator', () => {
  it('borrows the provider player and never owns its release', async () => {
    const player = createPlayer((source, emit) => {
      if (source !== null) {
        emit(status({ isLoaded: true, duration: 90 }));
      }
    });
    const prepare = jest.fn();
    const unregisterPlayer = registerSharedAudioPlayer(player as AudioPlayer);
    const unregisterPreparation = registerImportPlaybackPreparation(prepare);
    const validator = new ExpoAudioPartialValidator();

    try {
      await validator.validateLoadable('file:///private/shared.m4a.partial');
      validator.dispose();

      expect(prepare).toHaveBeenCalledTimes(1);
      expect(player.remove).not.toHaveBeenCalled();
    } finally {
      unregisterPreparation();
      unregisterPlayer();
    }
  });

  it('loads a local partial with one reusable expo-audio player and clears it', async () => {
    const player = createPlayer((source, emit) => {
      if (source !== null) {
        emit(status({ isLoaded: true, duration: 90 }));
      }
    });
    const createPlayerMock = jest.fn(() => player);
    const validator = new ExpoAudioPartialValidator({ createPlayer: createPlayerMock });

    await validator.validateLoadable('file:///private/audio-one.m4a.partial');
    // ImportCoordinator also performs best-effort cleanup in finally. It must
    // not send a second replace(null) into the shared Android player.
    validator.clearSource('file:///private/audio-one.m4a.partial');
    await validator.validateLoadable('file:///private/audio-two.m4a.partial');

    expect(createPlayerMock).toHaveBeenCalledTimes(1);
    expect(player.replace).toHaveBeenNthCalledWith(1, 'file:///private/audio-one.m4a.partial');
    expect(player.replace).toHaveBeenNthCalledWith(2, null);
    expect(player.replace).toHaveBeenNthCalledWith(3, 'file:///private/audio-two.m4a.partial');
    expect(player.replace).toHaveBeenNthCalledWith(4, null);
  });

  it('ignores a removed listener from an older validation generation', async () => {
    const listeners: Array<(value: AudioStatus) => void> = [];
    const player = createPlayer(() => undefined);
    player.addListener = jest.fn((_name, listener) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    });
    const validator = new ExpoAudioPartialValidator({ createPlayer: () => player });

    const first = validator.validateLoadable('file:///private/audio-one.m4a.partial');
    await waitForListeners(listeners, 1);
    listeners[0]?.(status({ isLoaded: true, duration: 90 }));
    await first;

    const second = validator.validateLoadable('file:///private/audio-two.m4a.partial');
    await waitForListeners(listeners, 2);
    listeners[0]?.(status({ error: 'late failure from source one' }));
    listeners[1]?.(status({ isLoaded: true, duration: 91 }));

    await expect(second).resolves.toBeUndefined();
  });

  it('maps expo-audio load errors to the stable media error code', async () => {
    const player = createPlayer((source, emit) => {
      if (source !== null) {
        emit(status({ error: 'decoder failed' }));
      }
    });
    const validator = new ExpoAudioPartialValidator({ createPlayer: () => player });

    await expect(
      validator.validateLoadable('file:///private/audio.m4a.partial'),
    ).rejects.toMatchObject({
      code: 'E_AUDIO_LOAD_FAILED',
      loadFailureStage: 'native-status',
    });
    expect(player.replace).toHaveBeenLastCalledWith(null);
  });

  it('maps shared-player preparation failures to the stable media error code', async () => {
    const unregisterPreparation = registerImportPlaybackPreparation(() => {
      throw new Error('native player rejected redundant source clearing');
    });
    const createPlayerMock = jest.fn(() => createPlayer(() => undefined));
    const validator = new ExpoAudioPartialValidator({ createPlayer: createPlayerMock });

    try {
      await expect(
        validator.validateLoadable('file:///private/audio.m4a.partial'),
      ).rejects.toMatchObject({ code: 'E_AUDIO_LOAD_FAILED', loadFailureStage: 'prepare' });
      expect(createPlayerMock).not.toHaveBeenCalled();
    } finally {
      unregisterPreparation();
    }
  });

  it('does not accept a stale loaded currentStatus from the previous source', async () => {
    const player = createPlayer(() => undefined);
    Object.defineProperty(player, 'currentStatus', {
      configurable: true,
      value: status({ isLoaded: true, duration: 90 }),
    });
    const validator = new ExpoAudioPartialValidator({
      createPlayer: () => player,
      timeoutMs: 10,
    });

    await expect(
      validator.validateLoadable('file:///private/unloadable.m4a.partial'),
    ).rejects.toMatchObject({ code: 'E_AUDIO_LOAD_FAILED', loadFailureStage: 'timeout' });
    expect(player.replace).toHaveBeenLastCalledWith(null);
  });

  it('does not accept content sources or run two load validations concurrently', async () => {
    const player = createPlayer(() => undefined);
    const validator = new ExpoAudioPartialValidator({
      createPlayer: () => player,
      timeoutMs: 60_000,
    });

    await expect(validator.validateLoadable('content://provider/audio')).rejects.toMatchObject({
      code: 'E_AUDIO_LOAD_FAILED',
    });
    const first = validator.validateLoadable('file:///private/one.m4a.partial');
    await expect(
      validator.validateLoadable('file:///private/two.m4a.partial'),
    ).rejects.toMatchObject({ code: 'E_AUDIO_LOAD_FAILED' });
    validator.clearSource();
    await expect(first).rejects.toMatchObject({ code: 'E_AUDIO_LOAD_FAILED' });
  });

  it('classifies synchronous player replacement failures without leaking their message', async () => {
    const player = createPlayer((source) => {
      if (source !== null) {
        throw new Error('file:///private/audio.m4a.partial decoder details');
      }
    });
    const validator = new ExpoAudioPartialValidator({ createPlayer: () => player });

    await expect(
      validator.validateLoadable('file:///private/audio.m4a.partial'),
    ).rejects.toMatchObject({ code: 'E_AUDIO_LOAD_FAILED', loadFailureStage: 'replace' });
    expect(player.replace).toHaveBeenLastCalledWith(null);
  });
});

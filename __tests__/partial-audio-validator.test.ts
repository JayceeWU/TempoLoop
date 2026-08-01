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
    await validator.validateLoadable('file:///private/audio-two.m4a.partial');

    expect(createPlayerMock).toHaveBeenCalledTimes(1);
    expect(player.replace).toHaveBeenNthCalledWith(1, 'file:///private/audio-one.m4a.partial');
    expect(player.replace).toHaveBeenNthCalledWith(2, null);
    expect(player.replace).toHaveBeenNthCalledWith(3, 'file:///private/audio-two.m4a.partial');
    expect(player.replace).toHaveBeenNthCalledWith(4, null);
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
    ).rejects.toMatchObject({ code: 'E_AUDIO_LOAD_FAILED' });
    expect(player.replace).toHaveBeenLastCalledWith(null);
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
    ).rejects.toMatchObject({ code: 'E_AUDIO_LOAD_FAILED' });
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
});

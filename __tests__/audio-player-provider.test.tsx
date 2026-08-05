import { act, render, waitFor } from '@testing-library/react-native';
import { Text, AppState, type AppStateStatus } from 'react-native';

import { AudioPlayerProvider } from '@/playback/AudioPlayerProvider';

const mockSetAudioMode = jest.fn<Promise<void>, [unknown]>(async () => undefined);
const mockSetAudioActive = jest.fn<Promise<void>, [boolean]>(async () => undefined);
const mockActivateKeepAwake = jest.fn<Promise<void>, [string]>(async () => undefined);
const mockDeactivateKeepAwake = jest.fn<Promise<void>, [string]>(async () => undefined);
const mockPlayer = {
  pause: jest.fn(),
  play: jest.fn(),
  replace: jest.fn(),
  seekTo: jest.fn(async () => undefined),
  setPlaybackRate: jest.fn(),
  shouldCorrectPitch: false,
};
const mockAudioStatus = {
  currentTime: 0,
  duration: 0,
  playing: false,
  didJustFinish: false,
  isLoaded: false,
  isBuffering: false,
  playbackRate: 1,
  error: null,
};

jest.mock('expo-audio', () => ({
  setAudioModeAsync: (options: unknown) => mockSetAudioMode(options),
  setIsAudioActiveAsync: (active: boolean) => mockSetAudioActive(active),
  useAudioPlayer: () => mockPlayer,
  useAudioPlayerStatus: () => mockAudioStatus,
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: (tag: string) => mockActivateKeepAwake(tag),
  deactivateKeepAwake: (tag: string) => mockDeactivateKeepAwake(tag),
}));

describe('AudioPlayerProvider lifecycle', () => {
  let appStateListener: ((state: AppStateStatus) => void) | null;
  let originalCurrentState: PropertyDescriptor | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListener = null;
    originalCurrentState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalCurrentState === undefined) {
      Reflect.deleteProperty(AppState, 'currentState');
    } else {
      Object.defineProperty(AppState, 'currentState', originalCurrentState);
    }
  });

  it('uses foreground playback mode and never auto-resumes after backgrounding', async () => {
    const screen = await render(
      <AudioPlayerProvider>
        <Text>child</Text>
      </AudioPlayerProvider>,
    );

    await waitFor(() => {
      expect(mockSetAudioMode).toHaveBeenCalledWith({
        allowsBackgroundRecording: false,
        allowsRecording: false,
        interruptionMode: 'doNotMix',
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
      expect(appStateListener).not.toBeNull();
    });

    await act(async () => {
      appStateListener?.('active');
    });
    mockPlayer.pause.mockClear();
    mockSetAudioActive.mockClear();

    await act(async () => {
      appStateListener?.('background');
    });
    expect(mockSetAudioActive).toHaveBeenCalledWith(false);

    await act(async () => {
      appStateListener?.('active');
    });
    expect(mockSetAudioActive).toHaveBeenCalledWith(true);
    expect(mockPlayer.play).not.toHaveBeenCalled();

    await act(async () => {
      screen.unmount();
    });
  });
});

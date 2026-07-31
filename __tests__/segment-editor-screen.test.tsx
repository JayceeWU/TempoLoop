import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import type { PlaybackSnapshot } from '../modules/dance-audio';
import SegmentEditorScreen from '../app/project/[projectId]/segments';
import type { DanceProject, WaveformFile } from '@/domain/project';
import { projectRepository } from '@/repositories/ProjectRepository';
import { waveformLoader } from '@/services/WaveformLoader';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useProjectStore } from '@/stores/useProjectStore';

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockNavigationDispatch = jest.fn();
let mockNowMs = 100_000;
let mockRouteParams: {
  projectId?: string | string[];
  origin?: string | string[];
} = {
  projectId: 'project-1',
  origin: 'practice',
};
let mockPreventRemoveEnabled = false;
let mockPreventRemoveCallback: ((options: { data: { action: object } }) => void) | null = null;

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const Stack = Object.assign(() => null, {
    Screen: () => null,
  });

  return {
    Stack,
    router: {
      back: () => {
        mockRouterBack();
        if (mockPreventRemoveEnabled) {
          mockPreventRemoveCallback?.({
            data: { action: { type: 'GO_BACK' } },
          });
        }
      },
      replace: (href: unknown) => {
        mockRouterReplace(href);
        if (mockPreventRemoveEnabled) {
          mockPreventRemoveCallback?.({
            data: { action: { type: 'REPLACE', payload: href } },
          });
        }
      },
    },
    useFocusEffect: (effect: () => void | (() => void)) => ReactModule.useEffect(effect, [effect]),
    useLocalSearchParams: () => mockRouteParams,
    useNavigation: () => ({
      dispatch: (action: object) => mockNavigationDispatch(action),
    }),
  };
});

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (
    enabled: boolean,
    callback: (options: { data: { action: object } }) => void,
  ) => {
    mockPreventRemoveEnabled = enabled;
    mockPreventRemoveCallback = callback;
  },
}));

jest.mock('@/components/WaveformScrubber', () => ({
  WaveformScrubber: ({
    currentTimeMs,
    disabled,
    onSeekRequested,
  }: {
    currentTimeMs: number;
    disabled?: boolean;
    onSeekRequested(positionMs: number): void;
  }) => {
    const { Pressable: NativePressable, Text: NativeText } =
      jest.requireActual<typeof import('react-native')>('react-native');

    return (
      <NativePressable
        accessibilityLabel={`Test waveform at ${currentTimeMs}`}
        accessibilityRole="adjustable"
        disabled={disabled}
        onPress={() => onSeekRequested(45_000)}
      >
        <NativeText>Test Waveform</NativeText>
      </NativePressable>
    );
  },
}));

const PROJECT: DanceProject = {
  schemaVersion: 1,
  id: 'project-1',
  name: 'Warm Up',
  createdAtIso: '2026-07-30T12:00:00.000Z',
  updatedAtIso: '2026-07-30T12:00:00.000Z',
  durationMs: 90_000,
  sourceVideoBytes: 1_024,
  audioRelativePath: 'Projects/project-1/audio.m4a',
  waveformRelativePath: 'Projects/project-1/waveform.json',
  preferredRate: 0.8,
  lastSelectedSegment: 1,
  segments: [
    { number: 1, startMs: 10_000, endMs: 20_000 },
    { number: 2, startMs: 15_000, endMs: 25_000 },
    { number: 3, startMs: null, endMs: null },
    { number: 4, startMs: null, endMs: null },
    { number: 5, startMs: null, endMs: null },
    { number: 6, startMs: null, endMs: null },
  ],
};

const WAVEFORM: WaveformFile = {
  schemaVersion: 1,
  pointCount: 2048,
  durationMs: PROJECT.durationMs,
  amplitudes: Array.from({ length: 2048 }, (_, index) => index / 2047),
};

const READY_SNAPSHOT: PlaybackSnapshot = {
  state: 'ready',
  currentTimeMs: 4_000,
  durationMs: PROJECT.durationMs,
  rate: 1,
  activeRangeStartMs: null,
  activeRangeEndMs: null,
};

const IDLE_COMMAND = {
  latestId: 0,
  pendingId: null,
  kind: null,
  status: 'idle',
} as const;

const mockInitialize = jest.fn(async () => undefined);
const mockUpdateSegments = jest.fn<
  Promise<void>,
  [projectId: string, segments: DanceProject['segments']]
>(async () => undefined);
const mockLoadAudio = jest.fn<Promise<PlaybackSnapshot>, [audioUri: string]>();
const mockPlayFrom = jest.fn<
  Promise<PlaybackSnapshot>,
  [positionMs: number, rate: 1 | 0.9 | 0.8 | 0.7]
>();
const mockPause = jest.fn<Promise<PlaybackSnapshot>, []>();
const mockSeek = jest.fn<Promise<PlaybackSnapshot>, [positionMs: number]>();
const mockStopAndSeek = jest.fn<Promise<PlaybackSnapshot>, [positionMs: number]>();
const mockSetRate = jest.fn<Promise<PlaybackSnapshot>, [rate: 1 | 0.9 | 0.8 | 0.7]>();
const mockRefreshSnapshot = jest.fn<Promise<PlaybackSnapshot>, []>();
const mockUnload = jest.fn<Promise<void>, []>();
const mockSetSelection = jest.fn();

function setSnapshot(next: PlaybackSnapshot): void {
  usePlaybackStore.setState({ snapshot: next });
}

function installPlaybackActions(): void {
  mockLoadAudio.mockImplementation(async () => {
    setSnapshot(READY_SNAPSHOT);
    return READY_SNAPSHOT;
  });
  mockPlayFrom.mockImplementation(async (positionMs, rate) => {
    const next: PlaybackSnapshot = {
      ...usePlaybackStore.getState().snapshot,
      state: 'playing',
      currentTimeMs: positionMs,
      rate,
      activeRangeStartMs: null,
      activeRangeEndMs: null,
    };
    setSnapshot(next);
    return next;
  });
  mockPause.mockImplementation(async () => {
    const next: PlaybackSnapshot = {
      ...usePlaybackStore.getState().snapshot,
      state: 'paused',
    };
    setSnapshot(next);
    return next;
  });
  mockSeek.mockImplementation(async (positionMs) => {
    const next: PlaybackSnapshot = {
      ...usePlaybackStore.getState().snapshot,
      currentTimeMs: positionMs,
    };
    setSnapshot(next);
    return next;
  });
  mockStopAndSeek.mockImplementation(async (positionMs) => {
    const next: PlaybackSnapshot = {
      ...usePlaybackStore.getState().snapshot,
      state: 'ready',
      currentTimeMs: positionMs,
      activeRangeStartMs: null,
      activeRangeEndMs: null,
    };
    setSnapshot(next);
    return next;
  });
  mockSetRate.mockImplementation(async (rate) => {
    const next: PlaybackSnapshot = {
      ...usePlaybackStore.getState().snapshot,
      rate,
    };
    usePlaybackStore.setState({
      selectedRate: rate,
      snapshot: next,
    });
    return next;
  });
  mockRefreshSnapshot.mockImplementation(async () => usePlaybackStore.getState().snapshot);
  mockUnload.mockImplementation(async () => {
    usePlaybackStore.setState({
      selectedProjectId: null,
      snapshot: {
        ...READY_SNAPSHOT,
        state: 'idle',
        currentTimeMs: 0,
        durationMs: 0,
      },
    });
  });
  mockSetSelection.mockImplementation(
    ({
      projectId,
      segmentNumber,
      rate,
    }: {
      projectId: string | null;
      segmentNumber: 1 | 2 | 3 | 4 | 5 | 6 | null;
      rate: 1 | 0.9 | 0.8 | 0.7;
    }) => {
      usePlaybackStore.setState({
        selectedProjectId: projectId,
        selectedSegment: segmentNumber,
        selectedRate: rate,
      });
    },
  );

  usePlaybackStore.setState({
    snapshot: READY_SNAPSHOT,
    lastEventReason: null,
    selectedProjectId: PROJECT.id,
    selectedSegment: 1,
    selectedRate: 1,
    command: IDLE_COMMAND,
    lastError: null,
    loadAudio: mockLoadAudio,
    playFrom: mockPlayFrom,
    pause: mockPause,
    seek: mockSeek,
    stopAndSeek: mockStopAndSeek,
    setRate: mockSetRate,
    refreshSnapshot: mockRefreshSnapshot,
    unload: mockUnload,
    setSelection: mockSetSelection,
  });
}

async function renderPreparedEditor() {
  const screen = await render(<SegmentEditorScreen />);

  await waitFor(() => {
    expect(screen.getByText('Test Waveform')).toBeTruthy();
    expect(screen.getByText('Segment 6')).toBeTruthy();
  });

  mockPause.mockClear();
  mockPlayFrom.mockClear();
  mockSeek.mockClear();
  mockStopAndSeek.mockClear();
  mockSetRate.mockClear();
  mockRefreshSnapshot.mockClear();
  mockUpdateSegments.mockClear();
  mockRouterBack.mockClear();
  mockRouterReplace.mockClear();
  mockNavigationDispatch.mockClear();
  return screen;
}

async function updateCurrentTime(currentTimeMs: number): Promise<void> {
  await act(async () => {
    setSnapshot({
      ...usePlaybackStore.getState().snapshot,
      currentTimeMs,
    });
    await Promise.resolve();
  });
}

function latestAlertButtons(): readonly AlertButton[] {
  const alertMock = Alert.alert as jest.MockedFunction<typeof Alert.alert>;
  const calls = alertMock.mock.calls;
  return (calls[calls.length - 1]?.[2] ?? []) as AlertButton[];
}

async function pressLatestAlertButton(label: string): Promise<void> {
  const button = latestAlertButtons().find((candidate) => candidate.text === label);
  expect(button).toBeDefined();

  await act(async () => {
    button?.onPress?.();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNowMs = 100_000;
  jest.spyOn(Date, 'now').mockImplementation(() => mockNowMs);
  mockRouteParams = {
    projectId: PROJECT.id,
    origin: 'practice',
  };
  mockPreventRemoveEnabled = false;
  mockPreventRemoveCallback = null;
  jest
    .spyOn(projectRepository, 'resolveAudioUri')
    .mockReturnValue('file:///documents/TempoLoop/Projects/project-1/audio.m4a');
  jest.spyOn(waveformLoader, 'load').mockResolvedValue(WAVEFORM);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useProjectStore.setState({
    projects: [PROJECT],
    isLoading: false,
    isInitialized: true,
    pendingProjectId: null,
    error: null,
    initialize: mockInitialize,
    updateSegments: mockUpdateSegments,
  });
  installPlaybackActions();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('segment editor screen', () => {
  it('renders the waveform, event time, and exactly six editable rows', async () => {
    const screen = await renderPreparedEditor();

    expect(screen.getByText('0:04.0 / 1:30.0')).toBeTruthy();
    expect(screen.getByText('Editor playback: 1.0x')).toBeTruthy();
    expect(screen.getAllByText(/^Segment [1-6]$/)).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('captures the latest native position with rounding and duration clamping', async () => {
    const screen = await renderPreparedEditor();

    await updateCurrentTime(10_000);
    mockRefreshSnapshot.mockResolvedValueOnce({
      ...usePlaybackStore.getState().snapshot,
      currentTimeMs: 10_350,
    });
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Set Segment 3 start',
      }),
    );
    await waitFor(() => {
      expect(screen.getByText('Start set to 0:10.4')).toBeTruthy();
    });
    expect(mockRefreshSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    mockRefreshSnapshot.mockResolvedValueOnce({
      ...usePlaybackStore.getState().snapshot,
      currentTimeMs: PROJECT.durationMs + 1_000,
    });
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Set Segment 3 end',
      }),
    );
    await waitFor(() => {
      expect(screen.getByText('End set to 1:30.0')).toBeTruthy();
    });
    expect(mockRefreshSnapshot).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('allows overlaps, rejects reversed ranges, and clears both endpoints', async () => {
    const screen = await renderPreparedEditor();

    await updateCurrentTime(18_000);
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Set Segment 3 start',
      }),
    );
    await updateCurrentTime(12_000);
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Set Segment 3 end',
      }),
    );

    expect(screen.getByText('Start must be earlier than end.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Clear Segment 3',
      }),
    );
    await waitFor(() => {
      expect(screen.queryByText('Start must be earlier than end.')).toBeNull();
    });

    await updateCurrentTime(12_000);
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Set Segment 3 start',
      }),
    );
    await updateCurrentTime(18_000);
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Set Segment 3 end',
      }),
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('guards immediate editor double taps, accepts a later pause, and seeks once', async () => {
    const screen = await renderPreparedEditor();

    await fireEvent.press(screen.getByRole('button', { name: 'Play at 1.0x' }));
    expect(mockPlayFrom).toHaveBeenCalledWith(4_000, 1);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(mockPause).not.toHaveBeenCalled();

    mockNowMs += 150;
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(mockPause).toHaveBeenCalledTimes(1);

    await fireEvent.press(
      screen.getByRole('adjustable', {
        name: 'Test waveform at 4000',
      }),
    );
    expect(mockSeek).toHaveBeenCalledTimes(1);
    expect(mockSeek).toHaveBeenCalledWith(45_000);
  });

  it('clears a stale practice range when taking editor ownership', async () => {
    usePlaybackStore.setState({
      snapshot: {
        ...READY_SNAPSHOT,
        state: 'paused',
        currentTimeMs: 7_500,
        rate: 0.8,
        activeRangeStartMs: 4_000,
        activeRangeEndMs: 20_000,
      },
      selectedRate: 0.8,
    });

    await render(<SegmentEditorScreen />);

    await waitFor(() => {
      expect(mockStopAndSeek).toHaveBeenCalledWith(7_500);
      expect(mockSetRate).toHaveBeenCalledWith(1);
    });
    expect(mockLoadAudio).not.toHaveBeenCalled();
  });

  it('pauses, freezes, revalidates, and saves one deep-copied draft atomically', async () => {
    const screen = await renderPreparedEditor();
    await updateCurrentTime(30_000);
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Set Segment 3 start',
      }),
    );
    await updateCurrentTime(40_000);
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Set Segment 3 end',
      }),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPause).toHaveBeenCalledTimes(1);
      expect(mockUpdateSegments).toHaveBeenCalledTimes(1);
      expect(mockRouterBack).toHaveBeenCalledTimes(1);
      expect(mockNavigationDispatch).toHaveBeenCalledWith({
        type: 'GO_BACK',
      });
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    const saved = mockUpdateSegments.mock.calls[0]?.[1];
    expect(saved).not.toBe(PROJECT.segments);
    expect(saved?.[0]).not.toBe(PROJECT.segments[0]);
    expect(saved?.[2]).toEqual({
      number: 3,
      startMs: 30_000,
      endMs: 40_000,
    });
  });

  it('protects invalid dirty drafts and replays the original back action only after discard', async () => {
    const screen = await renderPreparedEditor();
    await updateCurrentTime(30_000);
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Set Segment 4 start',
      }),
    );

    expect(mockPreventRemoveEnabled).toBe(true);
    const action = { type: 'GO_BACK' };
    await act(async () => {
      mockPreventRemoveCallback?.({ data: { action } });
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Incomplete changes cannot be saved',
      expect.stringContaining('Discard the entire draft'),
      expect.any(Array),
    );
    expect(mockNavigationDispatch).not.toHaveBeenCalled();

    await pressLatestAlertButton('Discard and Exit');
    await waitFor(() => {
      expect(mockPause).toHaveBeenCalledTimes(1);
      expect(mockNavigationDispatch).toHaveBeenCalledWith(action);
    });
    expect(mockUpdateSegments).not.toHaveBeenCalled();
  });

  it('pauses before a clean Cancel removal without showing a confirmation', async () => {
    const screen = await renderPreparedEditor();
    await fireEvent.press(screen.getByRole('button', { name: 'Play at 1.0x' }));
    mockPause.mockClear();
    mockNavigationDispatch.mockClear();

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(mockPause).toHaveBeenCalledTimes(1);
      expect(mockNavigationDispatch).toHaveBeenCalledWith({
        type: 'GO_BACK',
      });
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockPause.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigationDispatch.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('unloads once instead of racing pause when a deep-linked editor exits', async () => {
    mockRouteParams = { projectId: PROJECT.id };
    const screen = await renderPreparedEditor();
    await act(async () => {
      setSnapshot({
        ...READY_SNAPSHOT,
        state: 'playing',
      });
      await Promise.resolve();
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(mockUnload).toHaveBeenCalledTimes(1);
      expect(mockNavigationDispatch).toHaveBeenCalledWith({
        type: 'GO_BACK',
      });
    });
    expect(mockPause).not.toHaveBeenCalled();

    await screen.unmount();
    expect(mockUnload).toHaveBeenCalledTimes(1);
  });

  it('offers Continue Editing for a valid dirty draft without changing saved data', async () => {
    const screen = await renderPreparedEditor();
    await updateCurrentTime(30_000);
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Set Segment 4 start',
      }),
    );
    await updateCurrentTime(40_000);
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Set Segment 4 end',
      }),
    );

    const action = { type: 'GO_BACK' };
    await act(async () => {
      mockPreventRemoveCallback?.({ data: { action } });
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Discard changes?',
      'Your unsaved segment changes will be lost.',
      expect.any(Array),
    );

    await pressLatestAlertButton('Continue Editing');
    expect(mockPause).not.toHaveBeenCalled();
    expect(mockNavigationDispatch).not.toHaveBeenCalled();
    expect(mockUpdateSegments).not.toHaveBeenCalled();
  });

  it('loads a deep-linked project and returns successful saves to its practice screen', async () => {
    mockRouteParams = { projectId: PROJECT.id };
    usePlaybackStore.setState({
      selectedProjectId: null,
      selectedSegment: null,
      snapshot: {
        ...READY_SNAPSHOT,
        state: 'idle',
        durationMs: 0,
      },
    });

    const screen = await render(<SegmentEditorScreen />);
    await waitFor(() => {
      expect(mockLoadAudio).toHaveBeenCalledWith(
        'file:///documents/TempoLoop/Projects/project-1/audio.m4a',
      );
      expect(screen.getByText('Test Waveform')).toBeTruthy();
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith({
        pathname: '/project/[projectId]',
        params: { projectId: PROJECT.id },
      });
    });
  });
});

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { PlaybackSnapshot } from '../modules/dance-audio';
import PracticeProjectScreen from '../app/project/[projectId]';
import type { DanceProject } from '@/domain/project';
import { projectRepository } from '@/repositories/ProjectRepository';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { AppError } from '@/utils/errors';

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
let mockNowMs = 100_000;
let mockRouteParams: {
  projectId?: string | string[];
} = { projectId: 'project-1' };

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const Stack = Object.assign(() => null, {
    Screen: () => null,
  });

  return {
    Stack,
    router: {
      back: () => mockRouterBack(),
      push: (href: unknown) => mockRouterPush(href),
    },
    useFocusEffect: (effect: () => void | (() => void)) => ReactModule.useEffect(effect, [effect]),
    useLocalSearchParams: () => mockRouteParams,
  };
});

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
  preferredRate: 1,
  lastSelectedSegment: 1,
  segments: [
    { number: 1, startMs: 10_000, endMs: 20_000 },
    { number: 2, startMs: 30_000, endMs: 40_000 },
    { number: 3, startMs: null, endMs: null },
    { number: 4, startMs: null, endMs: null },
    { number: 5, startMs: null, endMs: null },
    { number: 6, startMs: null, endMs: null },
  ],
};

const READY_SNAPSHOT: PlaybackSnapshot = {
  state: 'ready',
  currentTimeMs: 4_000,
  durationMs: 90_000,
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
const mockUpdatePreferences = jest.fn(async () => undefined);
const mockLoadAudio = jest.fn<Promise<PlaybackSnapshot>, [audioUri: string]>();
const mockPlayRange = jest.fn<
  Promise<PlaybackSnapshot>,
  [startMs: number, endMs: number, rate: 1 | 0.9 | 0.8 | 0.7]
>();
const mockPause = jest.fn<Promise<PlaybackSnapshot>, []>();
const mockResume = jest.fn<Promise<PlaybackSnapshot>, []>();
const mockStopAndSeek = jest.fn<Promise<PlaybackSnapshot>, [positionMs: number]>();
const mockSetRate = jest.fn<Promise<PlaybackSnapshot>, [rate: 1 | 0.9 | 0.8 | 0.7]>();
const mockUnload = jest.fn<Promise<void>, []>();
const mockSetSelection = jest.fn();
const mockSetSelectedSegment = jest.fn();

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolvePromise!: (value: Value) => void;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise,
  };
}

function installPlaybackActions(): void {
  mockLoadAudio.mockImplementation(async () => {
    usePlaybackStore.setState({ snapshot: READY_SNAPSHOT });
    return READY_SNAPSHOT;
  });
  mockPlayRange.mockImplementation(async (startMs, endMs, rate) => {
    const next: PlaybackSnapshot = {
      ...READY_SNAPSHOT,
      state: 'playing',
      currentTimeMs: startMs,
      rate,
      activeRangeStartMs: startMs,
      activeRangeEndMs: endMs,
    };
    usePlaybackStore.setState({ snapshot: next });
    return next;
  });
  mockPause.mockImplementation(async () => {
    const next: PlaybackSnapshot = {
      ...usePlaybackStore.getState().snapshot,
      state: 'paused',
    };
    usePlaybackStore.setState({ snapshot: next });
    return next;
  });
  mockResume.mockImplementation(async () => {
    const next: PlaybackSnapshot = {
      ...usePlaybackStore.getState().snapshot,
      state: 'playing',
    };
    usePlaybackStore.setState({ snapshot: next });
    return next;
  });
  mockStopAndSeek.mockImplementation(async (positionMs) => {
    const next: PlaybackSnapshot = {
      ...READY_SNAPSHOT,
      currentTimeMs: positionMs,
    };
    usePlaybackStore.setState({ snapshot: next });
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
  mockUnload.mockImplementation(async () => {
    usePlaybackStore.setState({
      selectedProjectId: null,
      selectedSegment: null,
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
  mockSetSelectedSegment.mockImplementation((segmentNumber: 1 | 2 | 3 | 4 | 5 | 6 | null) => {
    usePlaybackStore.setState({
      selectedSegment: segmentNumber,
    });
  });

  usePlaybackStore.setState({
    snapshot: READY_SNAPSHOT,
    lastEventReason: null,
    selectedProjectId: PROJECT.id,
    selectedSegment: 1,
    selectedRate: 1,
    command: IDLE_COMMAND,
    lastError: null,
    loadAudio: mockLoadAudio,
    playRange: mockPlayRange,
    pause: mockPause,
    resume: mockResume,
    stopAndSeek: mockStopAndSeek,
    setRate: mockSetRate,
    unload: mockUnload,
    setSelection: mockSetSelection,
    setSelectedSegment: mockSetSelectedSegment,
  });
}

async function renderPreparedPracticeScreen() {
  const screen = await render(<PracticeProjectScreen />);
  await waitFor(() => {
    expect(mockStopAndSeek).toHaveBeenCalledWith(4_000);
  });

  mockStopAndSeek.mockClear();
  mockSetRate.mockClear();
  mockUpdatePreferences.mockClear();
  mockPause.mockClear();
  mockResume.mockClear();
  mockPlayRange.mockClear();
  mockRouterPush.mockClear();
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNowMs = 100_000;
  jest.spyOn(Date, 'now').mockImplementation(() => mockNowMs);
  mockRouteParams = { projectId: PROJECT.id };
  jest
    .spyOn(projectRepository, 'resolveAudioUri')
    .mockReturnValue('file:///documents/TempoLoop/Projects/project-1/audio.m4a');
  useProjectStore.setState({
    projects: [PROJECT],
    isLoading: false,
    isInitialized: true,
    pendingProjectId: null,
    error: null,
    initialize: mockInitialize,
    updatePreferences: mockUpdatePreferences,
  });
  installPlaybackActions();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('practice project screen', () => {
  it('loads project audio through the repository boundary and seeks the initial lead-in', async () => {
    usePlaybackStore.setState({
      selectedProjectId: null,
      selectedSegment: null,
      snapshot: {
        ...READY_SNAPSHOT,
        state: 'idle',
        currentTimeMs: 0,
        durationMs: 0,
      },
    });

    const screen = await render(<PracticeProjectScreen />);

    await waitFor(() => {
      expect(mockLoadAudio).toHaveBeenCalledWith(
        'file:///documents/TempoLoop/Projects/project-1/audio.m4a',
      );
      expect(mockStopAndSeek).toHaveBeenCalledWith(4_000);
    });
    expect(projectRepository.resolveAudioUri).toHaveBeenCalledWith(PROJECT);
    await screen.unmount();
  });

  it('starts the exact selected range at the selected rate', async () => {
    const screen = await renderPreparedPracticeScreen();

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Play selected segment',
      }),
    );

    expect(mockPlayRange).toHaveBeenCalledWith(4_000, 20_000, 1);
    await screen.unmount();
  });

  it('uses the native pause command while the range is playing', async () => {
    const screen = await renderPreparedPracticeScreen();
    await act(() => {
      usePlaybackStore.setState({
        snapshot: {
          ...READY_SNAPSHOT,
          state: 'playing',
          activeRangeStartMs: 4_000,
          activeRangeEndMs: 20_000,
        },
      });
    });

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Pause playback',
      }),
    );

    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockPlayRange).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('ignores an immediate playback double tap and accepts another toggle after 150 ms', async () => {
    const screen = await renderPreparedPracticeScreen();

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Play selected segment',
      }),
    );
    expect(mockPlayRange).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause playback' })).toBeTruthy();
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Pause playback' }));
    expect(mockPause).not.toHaveBeenCalled();

    mockNowMs += 150;
    await fireEvent.press(screen.getByRole('button', { name: 'Pause playback' }));
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockPlayRange).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it('resumes only a matching paused range and restarts a stale paused range', async () => {
    const screen = await renderPreparedPracticeScreen();

    await act(() => {
      usePlaybackStore.setState({
        snapshot: {
          ...READY_SNAPSHOT,
          state: 'paused',
          activeRangeStartMs: 4_000,
          activeRangeEndMs: 20_000,
        },
      });
    });
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Play selected segment',
      }),
    );
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(mockPlayRange).not.toHaveBeenCalled();

    mockResume.mockClear();
    mockNowMs += 150;
    await act(() => {
      usePlaybackStore.setState({
        snapshot: {
          ...READY_SNAPSHOT,
          state: 'paused',
          activeRangeStartMs: 3_000,
          activeRangeEndMs: 20_000,
        },
      });
    });
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Play selected segment',
      }),
    );
    expect(mockResume).not.toHaveBeenCalled();
    expect(mockPlayRange).toHaveBeenCalledWith(4_000, 20_000, 1);
    await screen.unmount();
  });

  it('changes speed without seeking and persists the latest coherent pair', async () => {
    const screen = await renderPreparedPracticeScreen();

    await fireEvent.press(
      screen.getByRole('radio', {
        name: '0.8x playback speed',
      }),
    );
    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith(PROJECT.id, 0.8, 1);
    });

    expect(mockSetRate).toHaveBeenCalledWith(0.8);
    expect(mockStopAndSeek).not.toHaveBeenCalled();
    expect(mockPlayRange).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('switches segments with one lead-in seek and persists the latest rate', async () => {
    usePlaybackStore.setState({ selectedRate: 0.9 });
    const screen = await renderPreparedPracticeScreen();
    await act(() => {
      usePlaybackStore.setState({ selectedRate: 0.9 });
    });

    await fireEvent.press(screen.getByRole('button', { name: /Segment 2/ }));
    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith(PROJECT.id, 0.9, 2);
    });

    expect(mockStopAndSeek).toHaveBeenCalledTimes(1);
    expect(mockStopAndSeek).toHaveBeenCalledWith(24_000);
    expect(mockPause).not.toHaveBeenCalled();
    expect(mockSetSelectedSegment).toHaveBeenCalledWith(2);
    await screen.unmount();
  });

  it('pauses before opening the editor and unloads directly on unmount', async () => {
    const screen = await renderPreparedPracticeScreen();

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Edit segment times',
      }),
    );
    expect(mockPause).toHaveBeenCalledTimes(1);
    const pauseResult = mockPause.mock.results[0]?.value;
    expect(pauseResult).toBeInstanceOf(Promise);
    if (pauseResult !== undefined) {
      await act(async () => {
        await pauseResult;
      });
    }
    expect(usePlaybackStore.getState().selectedProjectId).toBe(PROJECT.id);
    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith({
        pathname: '/project/[projectId]/segments',
        params: {
          projectId: PROJECT.id,
          origin: 'practice',
        },
      });
    });
    expect(mockPause.mock.invocationCallOrder[0]).toBeLessThan(
      mockRouterPush.mock.invocationCallOrder[0] ?? 0,
    );

    mockPause.mockClear();
    await screen.unmount();
    expect(mockUnload).toHaveBeenCalledTimes(1);
    expect(mockPause).not.toHaveBeenCalled();
  });

  it('does not navigate after an unresolved gear pause is superseded by unmount', async () => {
    const pendingPause = deferred<PlaybackSnapshot>();
    const screen = await renderPreparedPracticeScreen();
    mockPause.mockReturnValueOnce(pendingPause.promise);

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Edit segment times',
      }),
    );
    expect(mockPause).toHaveBeenCalledTimes(1);

    await screen.unmount();
    pendingPause.resolve({
      ...READY_SNAPSHOT,
      state: 'paused',
    });
    await act(async () => {
      await pendingPause.promise;
    });

    expect(mockUnload).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('offers an audio retry when lifecycle cancellation leaves loading idle', async () => {
    usePlaybackStore.setState({
      snapshot: {
        ...READY_SNAPSHOT,
        state: 'failed',
      },
    });
    mockLoadAudio.mockRejectedValueOnce(
      new AppError('E_CANCELLED', 'Loading was cancelled when the app became inactive.'),
    );

    const screen = await render(<PracticeProjectScreen />);
    await waitFor(() => {
      expect(mockLoadAudio).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeOnTheScreen();
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Try Again' }));
    await waitFor(() => {
      expect(mockLoadAudio).toHaveBeenCalledTimes(2);
    });
    await screen.unmount();
  });

  it('shows not-found instead of an endless spinner for an initialized empty library', async () => {
    useProjectStore.setState({
      projects: [],
      isInitialized: true,
      isLoading: false,
      error: null,
    });

    const screen = await render(<PracticeProjectScreen />);

    expect(screen.getByText('Project not found')).toBeOnTheScreen();
    expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
    await screen.unmount();
  });

  it('offers an explicit project-library retry without an initialization loop', async () => {
    useProjectStore.setState({
      projects: [],
      isInitialized: false,
      isLoading: false,
      error: 'Index could not be read.',
    });

    const screen = await render(<PracticeProjectScreen />);
    expect(mockInitialize).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Try Again' }));
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });
});

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import PracticeProjectScreen from '../app/project/[projectId]';
import type { PlaybackRate, PlaybackSnapshot } from '@/domain/playback';
import type { DanceProject } from '@/domain/project';
import type { PracticeSegmentInput } from '@/playback/PlaybackCoordinator';
import type { TempoLoopPlayerController } from '@/playback/useTempoLoopPlayer';
import { projectRepository } from '@/repositories/ProjectRepository';
import { useProjectStore } from '@/stores/useProjectStore';

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
let mockCanGoBack = true;
const mockEnterPractice = jest.fn<
  ReturnType<TempoLoopPlayerController['enterPractice']>,
  Parameters<TempoLoopPlayerController['enterPractice']>
>();
const mockPreparePracticeSegment = jest.fn<
  ReturnType<TempoLoopPlayerController['preparePracticeSegment']>,
  Parameters<TempoLoopPlayerController['preparePracticeSegment']>
>();
const mockTogglePractice = jest.fn<
  ReturnType<TempoLoopPlayerController['togglePractice']>,
  Parameters<TempoLoopPlayerController['togglePractice']>
>();
const mockPause = jest.fn();
const mockSetRate = jest.fn<boolean, [PlaybackRate]>();
const mockDeactivate = jest.fn();
const mockUpdateSelectedRate = jest.fn(async () => undefined);
const mockUpdateLeadInMs = jest.fn(async () => undefined);
const mockInitialize = jest.fn(async () => undefined);

let mockRouteParams: { projectId?: string | string[] } = { projectId: 'project-1' };
let mockSnapshot: PlaybackSnapshot;
const mockSnapshotListeners = new Set<() => void>();

function mockGetSnapshot(): PlaybackSnapshot {
  return mockSnapshot;
}

function mockSubscribe(listener: () => void): () => void {
  mockSnapshotListeners.add(listener);
  return () => mockSnapshotListeners.delete(listener);
}

function mockPatchSnapshot(patch: Partial<PlaybackSnapshot>): void {
  mockSnapshot = { ...mockSnapshot, ...patch };
  for (const listener of mockSnapshotListeners) {
    listener();
  }
}

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const Stack = Object.assign(() => null, { Screen: () => null });
  return {
    Stack,
    router: {
      back: () => mockRouterBack(),
      canGoBack: () => mockCanGoBack,
      push: (href: unknown) => mockRouterPush(href),
      replace: (href: unknown) => mockRouterReplace(href),
    },
    useFocusEffect: (effect: () => void | (() => void)) => ReactModule.useEffect(effect, [effect]),
    useLocalSearchParams: () => mockRouteParams,
  };
});

jest.mock('@/playback/useTempoLoopPlayer', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useTempoLoopPlayer: (): TempoLoopPlayerController => ({
      snapshot: ReactModule.useSyncExternalStore(mockSubscribe, mockGetSnapshot, mockGetSnapshot),
      enterEditor: jest.fn(),
      enterPractice: mockEnterPractice,
      preparePracticeSegment: mockPreparePracticeSegment,
      togglePractice: mockTogglePractice,
      playEditor: jest.fn(),
      pause: mockPause,
      seekEditor: jest.fn(),
      setRate: mockSetRate,
      getCurrentPositionMs: () => mockSnapshot.sourcePositionMs,
      deactivate: mockDeactivate,
      clearSource: jest.fn(),
    }),
  };
});

const PROJECT: DanceProject = {
  schemaVersion: 1,
  id: 'project-1',
  name: 'Warm Up',
  createdAtIso: '2026-07-30T12:00:00.000Z',
  updatedAtIso: '2026-07-30T12:00:00.000Z',
  audioFileName: 'audio.m4a',
  waveformFileName: 'waveform.json',
  waveformStatus: 'ready',
  durationMs: 90_000,
  sourceDisplayName: null,
  sourceSizeBytes: 1_024,
  selectedRate: 1,
  leadInMs: 6_000,
  segments: [
    { id: 'segment-1', index: 0, startMs: 10_000, endMs: 20_000 },
    { id: 'segment-2', index: 1, startMs: 30_000, endMs: 40_000 },
    { id: 'segment-3', index: 2, startMs: null, endMs: null },
    { id: 'segment-4', index: 3, startMs: null, endMs: null },
    { id: 'segment-5', index: 4, startMs: null, endMs: null },
    { id: 'segment-6', index: 5, startMs: null, endMs: null },
    { id: 'segment-7', index: 6, startMs: null, endMs: null },
    { id: 'segment-8', index: 7, startMs: null, endMs: null },
    { id: 'segment-9', index: 8, startMs: null, endMs: null },
  ],
};

function idleSnapshot(): PlaybackSnapshot {
  return {
    mode: 'idle',
    status: 'idle',
    projectId: null,
    segmentIndex: null,
    sourcePositionMs: 0,
    sourceDurationMs: 0,
    clipStartMs: 0,
    clipEndMs: null,
    rate: 1,
    countdownRemainingSeconds: null,
    commandGeneration: 0,
  };
}

function installPlayerBehavior(): void {
  mockEnterPractice.mockImplementation(async (input, rate) => {
    mockPatchSnapshot({
      mode: 'practice',
      status: 'ready',
      projectId: input.projectId,
      segmentIndex: null,
      sourcePositionMs: 0,
      sourceDurationMs: input.durationMs,
      clipStartMs: 0,
      clipEndMs: null,
      rate,
      commandGeneration: mockSnapshot.commandGeneration + 1,
    });
    return true;
  });
  mockPreparePracticeSegment.mockImplementation(async (input: PracticeSegmentInput) => {
    mockPatchSnapshot({
      status: 'ready',
      segmentIndex: input.segmentIndex,
      sourcePositionMs: input.clipStartMs,
      clipStartMs: input.clipStartMs,
      clipEndMs: input.clipEndMs,
      rate: input.rate,
      commandGeneration: mockSnapshot.commandGeneration + 1,
    });
    return true;
  });
  mockTogglePractice.mockImplementation(async () => {
    mockPatchSnapshot({
      status: mockSnapshot.status === 'playing' ? 'paused' : 'playing',
      commandGeneration: mockSnapshot.commandGeneration + 1,
    });
    return true;
  });
  mockPause.mockImplementation(() => {
    if (mockSnapshot.status !== 'idle' && mockSnapshot.status !== 'error') {
      mockPatchSnapshot({
        status: 'paused',
        commandGeneration: mockSnapshot.commandGeneration + 1,
      });
    }
  });
  mockSetRate.mockImplementation((rate) => {
    mockPatchSnapshot({ rate, commandGeneration: mockSnapshot.commandGeneration + 1 });
    return true;
  });
  mockDeactivate.mockImplementation(() => {
    mockPatchSnapshot({
      mode: 'idle',
      status: 'idle',
      projectId: null,
      segmentIndex: null,
      clipStartMs: 0,
      clipEndMs: null,
      commandGeneration: mockSnapshot.commandGeneration + 1,
    });
  });
}

async function renderPrepared(project: DanceProject = PROJECT) {
  useProjectStore.setState({ projects: [project] });
  const screen = await render(<PracticeProjectScreen />);
  const firstSegmentStartMs = project.segments[0].startMs ?? 0;
  await waitFor(() => {
    expect(mockPreparePracticeSegment).toHaveBeenCalledWith({
      segmentIndex: 0,
      clipStartMs: Math.max(0, firstSegmentStartMs - project.leadInMs),
      clipEndMs: 20_000,
      countdownMs: Math.max(0, project.leadInMs - firstSegmentStartMs),
      rate: project.selectedRate,
    });
  });
  return screen;
}

function expectConfiguredPracticeChoicesEnabled(
  screen: Awaited<ReturnType<typeof renderPrepared>>,
): void {
  for (const speedButton of screen.getAllByRole('radio')) {
    expect(speedButton).toBeEnabled();
  }
  expect(screen.getByRole('button', { name: /Segment 1/ })).toBeEnabled();
  expect(screen.getByRole('button', { name: /Segment 2/ })).toBeEnabled();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSnapshotListeners.clear();
  mockSnapshot = idleSnapshot();
  mockCanGoBack = true;
  mockRouteParams = { projectId: PROJECT.id };
  jest
    .spyOn(projectRepository, 'resolveAudioUri')
    .mockReturnValue('file:///documents/TempoLoop/projects/project-1/audio.m4a');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useProjectStore.setState({
    projects: [PROJECT],
    isLoading: false,
    isInitialized: true,
    pendingProjectId: null,
    error: null,
    initialize: mockInitialize,
    updateSelectedRate: mockUpdateSelectedRate,
    updateLeadInMs: mockUpdateLeadInMs,
  });
  installPlayerBehavior();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Android practice project screen', () => {
  it('returns a root project route to the project list without dispatching GO_BACK', async () => {
    mockCanGoBack = false;
    const screen = await renderPrepared();

    await fireEvent.press(screen.getByRole('button', { name: 'Back to projects' }));

    expect(mockPause).toHaveBeenCalled();
    expect(mockRouterBack).not.toHaveBeenCalled();
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
  });

  it('enters the shared player and prepares the first valid segment at its lead-in', async () => {
    const screen = await renderPrepared();

    expect(mockEnterPractice).toHaveBeenCalledWith(
      {
        projectId: PROJECT.id,
        audioUri: 'file:///documents/TempoLoop/projects/project-1/audio.m4a',
        durationMs: PROJECT.durationMs,
      },
      1,
    );
    expect(
      screen.getByRole('button', { name: /Segment 1/ }).props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(screen.getByRole('button', { name: 'Play selected segment' })).toBeEnabled();
  });

  it('places the lead-in slider between speed and segment selection', async () => {
    const screen = await renderPrepared();
    const rendered = JSON.stringify(screen.toJSON());
    const speedIndex = rendered.indexOf('Speed');
    const leadInIndex = rendered.indexOf('Start before');
    const segmentsIndex = rendered.indexOf('Practice segments');

    expect(speedIndex).toBeGreaterThanOrEqual(0);
    expect(leadInIndex).toBeGreaterThan(speedIndex);
    expect(segmentsIndex).toBeGreaterThan(leadInIndex);
    expect(screen.getByText('Start before')).toHaveStyle({ marginTop: 24 });
    expect(screen.getByText('Practice segments')).toHaveStyle({ marginTop: 24 });
  });

  it('does not show a range or current-position summary below the segment grid', async () => {
    const screen = await renderPrepared();

    expect(screen.queryByText(/Current /)).toBeNull();
    expect(screen.queryByText('Set at least one segment to begin practicing.')).toBeNull();
  });

  it('keeps Play disabled when no segment is configured', async () => {
    const emptyProject: DanceProject = {
      ...PROJECT,
      segments: PROJECT.segments.map((segment) => ({
        ...segment,
        startMs: null,
        endMs: null,
      })) as DanceProject['segments'],
    };
    useProjectStore.setState({ projects: [emptyProject] });
    const screen = await render(<PracticeProjectScreen />);
    await waitFor(() => expect(mockEnterPractice).toHaveBeenCalled());

    expect(mockPreparePracticeSegment).not.toHaveBeenCalled();
    expect(screen.queryByText('Set at least one segment to begin practicing.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play selected segment' })).toBeDisabled();
  });

  it('prepares a selected segment without starting playback', async () => {
    const screen = await renderPrepared();
    mockPreparePracticeSegment.mockClear();
    mockTogglePractice.mockClear();

    await fireEvent.press(screen.getByRole('button', { name: /Segment 2/ }));

    expect(mockPreparePracticeSegment).toHaveBeenCalledWith({
      segmentIndex: 1,
      clipStartMs: 24_000,
      clipEndMs: 40_000,
      countdownMs: 0,
      rate: 1,
    });
    expect(mockTogglePractice).not.toHaveBeenCalled();
  });

  it('applies a playing rate immediately without seek/reload and persists it', async () => {
    const screen = await renderPrepared();
    mockEnterPractice.mockClear();
    mockPreparePracticeSegment.mockClear();
    await act(() => {
      mockPatchSnapshot({ status: 'playing' });
    });

    await fireEvent.press(screen.getByRole('radio', { name: '0.8x speed' }));

    expect(mockSetRate).toHaveBeenCalledWith(0.8);
    expect(mockEnterPractice).not.toHaveBeenCalled();
    expect(mockPreparePracticeSegment).not.toHaveBeenCalled();
    await waitFor(() => expect(mockUpdateSelectedRate).toHaveBeenCalledWith(PROJECT.id, 0.8));
  });

  it('keeps speed and configured segments enabled while lead-in persistence is pending', async () => {
    let resolvePreference!: (value: undefined) => void;
    const pendingPreference = new Promise<undefined>((resolve) => {
      resolvePreference = resolve;
    });
    mockUpdateLeadInMs.mockReturnValueOnce(pendingPreference);
    const screen = await renderPrepared();

    fireEvent(
      screen.getByRole('adjustable', { name: 'Seconds before segment start' }),
      'accessibilityAction',
      { nativeEvent: { actionName: 'decrement' } },
    );
    await waitFor(() => expect(mockUpdateLeadInMs).toHaveBeenCalledWith(PROJECT.id, 4_000));

    await act(() => {
      useProjectStore.setState({ pendingProjectId: PROJECT.id });
    });

    expectConfiguredPracticeChoicesEnabled(screen);

    await act(async () => {
      useProjectStore.setState({ pendingProjectId: null });
      resolvePreference(undefined);
      await pendingPreference;
    });
  });

  it('keeps speed and configured segments enabled while speed persistence is pending', async () => {
    let resolvePreference!: (value: undefined) => void;
    const pendingPreference = new Promise<undefined>((resolve) => {
      resolvePreference = resolve;
    });
    mockUpdateSelectedRate.mockReturnValueOnce(pendingPreference);
    const screen = await renderPrepared();

    fireEvent.press(screen.getByRole('radio', { name: '0.8x speed' }));
    await waitFor(() => expect(mockUpdateSelectedRate).toHaveBeenCalledWith(PROJECT.id, 0.8));

    await act(() => {
      useProjectStore.setState({ pendingProjectId: PROJECT.id });
    });

    expectConfiguredPracticeChoicesEnabled(screen);

    await act(async () => {
      useProjectStore.setState({ pendingProjectId: null });
      resolvePreference(undefined);
      await pendingPreference;
    });
  });

  it('keeps lead-in, speed and configured segments enabled while segment preparation is pending', async () => {
    let resolvePreparation!: (prepared: boolean) => void;
    const pendingPreparation = new Promise<boolean>((resolve) => {
      resolvePreparation = resolve;
    });
    const screen = await renderPrepared();
    mockPreparePracticeSegment.mockClear();
    mockPreparePracticeSegment.mockReturnValueOnce(pendingPreparation);

    fireEvent.press(screen.getByRole('button', { name: /Segment 2/ }));
    await waitFor(() => expect(mockPreparePracticeSegment).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('adjustable', { name: 'Seconds before segment start' })).toBeEnabled();
    expectConfiguredPracticeChoicesEnabled(screen);

    await act(async () => {
      resolvePreparation(true);
      await pendingPreparation;
    });
  });

  it('starts from the range beginning and resets there when Pause is pressed', async () => {
    const screen = await renderPrepared();
    mockPreparePracticeSegment.mockClear();

    await fireEvent.press(screen.getByRole('button', { name: 'Play selected segment' }));
    expect(mockPreparePracticeSegment).toHaveBeenLastCalledWith({
      segmentIndex: 0,
      clipStartMs: 4_000,
      clipEndMs: 20_000,
      countdownMs: 0,
      rate: 1,
    });
    expect(mockTogglePractice).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause playback' })).toBeTruthy();
    });

    await act(() => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 200);
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Pause playback' }));
    expect(mockPreparePracticeSegment).toHaveBeenCalledTimes(2);
    expect(mockPreparePracticeSegment).toHaveBeenLastCalledWith({
      segmentIndex: 0,
      clipStartMs: 4_000,
      clipEndMs: 20_000,
      countdownMs: 0,
      rate: 1,
    });
    expect(mockTogglePractice).toHaveBeenCalledTimes(1);
    expect(mockSnapshot.status).toBe('ready');
    expect(mockSnapshot.sourcePositionMs).toBe(4_000);
  });

  it('shows the missing lead-in as a silent countdown only on the Play button', async () => {
    const segments = [...PROJECT.segments] as DanceProject['segments'];
    segments[0] = { ...segments[0], startMs: 3_000, endMs: 20_000 };
    const project = { ...PROJECT, leadInMs: 8_000 as const, segments };
    const screen = await renderPrepared(project);
    mockPreparePracticeSegment.mockClear();
    mockTogglePractice.mockImplementationOnce(async () => {
      mockPatchSnapshot({
        status: 'countdown',
        countdownRemainingSeconds: 5,
        commandGeneration: mockSnapshot.commandGeneration + 1,
      });
      return true;
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Play selected segment' }));

    expect(mockPreparePracticeSegment).toHaveBeenCalledWith({
      segmentIndex: 0,
      clipStartMs: 0,
      clipEndMs: 20_000,
      countdownMs: 5_000,
      rate: 1,
    });
    expect(
      screen.getByRole('button', { name: 'Starting in 5 seconds. Tap to cancel.' }),
    ).toBeEnabled();
    expect(screen.getByRole('adjustable', { name: 'Seconds before segment start' })).toBeEnabled();
    expectConfiguredPracticeChoicesEnabled(screen);
  });

  it.each([
    { status: 'ready' as const, buttonName: 'Play selected segment' },
    { status: 'playing' as const, buttonName: 'Pause playback' },
  ])(
    'keeps the lead-in slider enabled while $status is being toggled',
    async ({ status, buttonName }) => {
      const screen = await renderPrepared();
      await act(() => {
        mockPatchSnapshot({ status });
      });
      mockPreparePracticeSegment.mockClear();
      let resolvePreparation = (_prepared: boolean): void => undefined;
      const pendingPreparation = new Promise<boolean>((resolve) => {
        resolvePreparation = resolve;
      });
      mockPreparePracticeSegment.mockReturnValueOnce(pendingPreparation);

      fireEvent.press(screen.getByRole('button', { name: buttonName }));
      await waitFor(() => expect(mockPreparePracticeSegment).toHaveBeenCalledTimes(1));

      expect(
        screen.getByRole('adjustable', { name: 'Seconds before segment start' }),
      ).toBeEnabled();

      await act(async () => {
        resolvePreparation(true);
        await pendingPreparation;
      });
    },
  );

  it('pauses playback when lead-in changes and uses the new value on the next Play', async () => {
    const screen = await renderPrepared();
    await act(() => {
      mockPatchSnapshot({ status: 'playing', sourcePositionMs: 12_500 });
    });
    mockPreparePracticeSegment.mockClear();
    mockPause.mockClear();

    await fireEvent(
      screen.getByRole('adjustable', { name: 'Seconds before segment start' }),
      'accessibilityAction',
      { nativeEvent: { actionName: 'decrement' } },
    );

    expect(screen.getByText('Start before')).toBeTruthy();
    expect(screen.queryByText(/4 seconds/)).toBeNull();
    expect(mockSnapshot.status).toBe('paused');
    expect(mockSnapshot.sourcePositionMs).toBe(12_500);
    expect(mockPreparePracticeSegment).not.toHaveBeenCalled();
    expect(mockPause).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockUpdateLeadInMs).toHaveBeenCalledWith(PROJECT.id, 4_000));

    await fireEvent.press(screen.getByRole('button', { name: 'Play selected segment' }));
    expect(mockPreparePracticeSegment).toHaveBeenCalledWith({
      segmentIndex: 0,
      clipStartMs: 6_000,
      clipEndMs: 20_000,
      countdownMs: 0,
      rate: 1,
    });
    expect(mockTogglePractice).toHaveBeenCalledTimes(1);
  });

  it('shows an error if the lead-in preference cannot be saved', async () => {
    mockUpdateLeadInMs.mockRejectedValueOnce(new Error('write failed'));
    const screen = await renderPrepared();

    await fireEvent(
      screen.getByRole('adjustable', { name: 'Seconds before segment start' }),
      'accessibilityAction',
      { nativeEvent: { actionName: 'decrement' } },
    );

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Preference could not be saved',
        'The current choice works for this session, but TempoLoop could not save it.',
      );
    });
  });

  it('prepares the lead-in again before manual Play after an interruption', async () => {
    const project = { ...PROJECT, leadInMs: 2_000 as const };
    const screen = await renderPrepared(project);
    mockPreparePracticeSegment.mockClear();
    await act(() => {
      mockPatchSnapshot({ status: 'paused', sourcePositionMs: 17_000 });
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Play selected segment' }));

    expect(mockPreparePracticeSegment).toHaveBeenCalledWith({
      segmentIndex: 0,
      clipStartMs: 8_000,
      clipEndMs: 20_000,
      countdownMs: 0,
      rate: 1,
    });
    expect(mockPreparePracticeSegment.mock.invocationCallOrder[0]).toBeLessThan(
      mockTogglePractice.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(mockSnapshot.status).toBe('playing');
  });

  it('pauses before opening settings and deactivates on route exit', async () => {
    const screen = await renderPrepared();

    await fireEvent.press(screen.getByRole('button', { name: 'Edit segment times' }));

    expect(mockPause).toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/project/[projectId]/segments',
      params: { projectId: PROJECT.id, origin: 'practice' },
    });
    expect(mockPause.mock.invocationCallOrder[0]).toBeLessThan(
      mockRouterPush.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );

    await act(async () => {
      screen.unmount();
    });
    expect(mockDeactivate).toHaveBeenCalled();
  });

  it('allows a newer segment selection while an older seek is pending', async () => {
    let resolveFirst!: (value: boolean) => void;
    const firstSeek = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    const screen = await renderPrepared();
    mockPreparePracticeSegment.mockClear();
    mockPreparePracticeSegment
      .mockImplementationOnce(() => firstSeek)
      .mockImplementationOnce(async () => true);

    await fireEvent.press(screen.getByRole('button', { name: /Segment 2/ }));
    await fireEvent.press(screen.getByRole('button', { name: /Segment 1/ }));

    expect(mockPreparePracticeSegment).toHaveBeenCalledTimes(2);
    await act(async () => resolveFirst(false));
  });
});

import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import SegmentEditorScreen from '../app/project/[projectId]/segments';
import type { PlaybackSnapshot } from '@/domain/playback';
import type { DanceProject, StoredWaveform } from '@/domain/project';
import type { TempoLoopPlayerController } from '@/playback/useTempoLoopPlayer';
import { projectRepository } from '@/repositories/ProjectRepository';
import { waveformLoader } from '@/services/WaveformLoader';
import { useProjectStore } from '@/stores/useProjectStore';

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockNavigationDispatch = jest.fn();
let mockCanGoBack = true;
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
          mockPreventRemoveCallback?.({ data: { action: { type: 'GO_BACK' } } });
        }
      },
      canGoBack: () => mockCanGoBack,
      replace: (href: unknown) => {
        mockRouterReplace(href);
        if (mockPreventRemoveEnabled) {
          mockPreventRemoveCallback?.({ data: { action: { type: 'REPLACE', payload: href } } });
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
    onScrubCancel,
    onScrubStart,
    onSeekPreview,
    onSeekRequested,
  }: {
    currentTimeMs: number;
    disabled?: boolean;
    onScrubCancel?(): void;
    onScrubStart?(): void;
    onSeekPreview?(positionMs: number): void;
    onSeekRequested(positionMs: number): void;
  }) => {
    const {
      Pressable: NativePressable,
      Text: NativeText,
      View: NativeView,
    } = jest.requireActual<typeof import('react-native')>('react-native');

    return (
      <NativeView accessibilityLabel={`Test waveform at ${currentTimeMs}`} testID="mock-waveform">
        <NativeText>Test Waveform</NativeText>
        <NativePressable
          disabled={disabled}
          onPress={onScrubStart}
          accessibilityLabel="Scrub start"
        />
        <NativePressable
          disabled={disabled}
          onPress={() => onSeekPreview?.(45_000)}
          accessibilityLabel="Scrub preview"
        />
        <NativePressable
          disabled={disabled}
          onPress={() => onSeekRequested(55_000)}
          accessibilityLabel="Scrub finish"
        />
        <NativePressable
          disabled={disabled}
          onPress={onScrubCancel}
          accessibilityLabel="Scrub cancel"
        />
      </NativeView>
    );
  },
}));

const PROJECT: DanceProject = {
  schemaVersion: 2,
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
  selectedRate: 0.8,
  leadInMs: 6_000,
  practiceMarkers: {
    startMs: [0, 5_000, null, null, null, null],
    finalEndMs: 90_000,
  },
};

const WAVEFORM: StoredWaveform = {
  schemaVersion: 1,
  sampleCount: 2048,
  durationMs: PROJECT.durationMs,
  samples: Array.from({ length: 2048 }, (_, index) => index / 2047),
};

const READY_SNAPSHOT: PlaybackSnapshot = {
  mode: 'editor',
  status: 'ready',
  projectId: PROJECT.id,
  segmentIndex: null,
  sourcePositionMs: 4_000,
  sourceDurationMs: PROJECT.durationMs,
  clipStartMs: 0,
  clipEndMs: null,
  rate: 1,
  countdownRemainingSeconds: null,
  commandGeneration: 1,
};

let mockSnapshot: PlaybackSnapshot = READY_SNAPSHOT;
const mockEnterEditor = jest.fn(async () => true);
const mockEnterPractice = jest.fn(async () => true);
const mockPreparePracticeSegment = jest.fn(async () => true);
const mockTogglePractice = jest.fn(async () => true);
const mockPlayEditor = jest.fn(async () => true);
const mockPause = jest.fn();
const mockSeekEditor = jest.fn(async () => true);
const mockSetRate = jest.fn(() => true);
const mockGetCurrentPositionMs = jest.fn(() => mockSnapshot.sourcePositionMs);
const mockDeactivate = jest.fn();
const mockClearSource = jest.fn(() => true);

const mockUseTempoLoopPlayer = jest.fn((): TempoLoopPlayerController => ({
  snapshot: mockSnapshot,
  enterEditor: mockEnterEditor,
  enterPractice: mockEnterPractice,
  preparePracticeSegment: mockPreparePracticeSegment,
  togglePractice: mockTogglePractice,
  playEditor: mockPlayEditor,
  pause: mockPause,
  seekEditor: mockSeekEditor,
  setRate: mockSetRate,
  getCurrentPositionMs: mockGetCurrentPositionMs,
  deactivate: mockDeactivate,
  clearSource: mockClearSource,
}));

jest.mock('@/playback/useTempoLoopPlayer', () => ({
  useTempoLoopPlayer: () => mockUseTempoLoopPlayer(),
}));

const mockInitialize = jest.fn(async () => undefined);
const mockUpdatePracticeMarkers = jest.fn<
  Promise<void>,
  [projectId: string, markers: DanceProject['practiceMarkers']]
>(async () => undefined);

async function renderPreparedEditor() {
  const screen = await render(<SegmentEditorScreen />);

  await waitFor(() => {
    expect(screen.getByText('Test Waveform')).toBeTruthy();
    expect(screen.getByLabelText('Final End')).toBeTruthy();
    expect(mockEnterEditor).toHaveBeenCalledWith({
      projectId: PROJECT.id,
      audioUri: 'file:///documents/TempoLoop/projects/project-1/audio.m4a',
      durationMs: PROJECT.durationMs,
    });
  });

  mockPause.mockClear();
  mockPlayEditor.mockClear();
  mockSeekEditor.mockClear();
  mockGetCurrentPositionMs.mockClear();
  mockDeactivate.mockClear();
  mockUpdatePracticeMarkers.mockClear();
  mockRouterBack.mockClear();
  mockRouterReplace.mockClear();
  mockNavigationDispatch.mockClear();
  return screen;
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
  mockCanGoBack = true;
  mockRouteParams = {
    projectId: PROJECT.id,
    origin: 'practice',
  };
  mockPreventRemoveEnabled = false;
  mockPreventRemoveCallback = null;
  mockSnapshot = READY_SNAPSHOT;
  mockGetCurrentPositionMs.mockImplementation(() => mockSnapshot.sourcePositionMs);
  jest
    .spyOn(projectRepository, 'resolveAudioUri')
    .mockReturnValue('file:///documents/TempoLoop/projects/project-1/audio.m4a');
  jest.spyOn(waveformLoader, 'load').mockResolvedValue(WAVEFORM);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useProjectStore.setState({
    projects: [PROJECT],
    isLoading: false,
    isInitialized: true,
    pendingProjectId: null,
    error: null,
    initialize: mockInitialize,
    updatePracticeMarkers: mockUpdatePracticeMarkers,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('segment editor screen', () => {
  it('keeps playback and segment capture available while the waveform is pending', async () => {
    useProjectStore.setState({
      projects: [{ ...PROJECT, waveformStatus: 'pending' }],
    });

    const screen = await render(<SegmentEditorScreen />);

    await waitFor(() => expect(screen.getByText('Building waveform 0%')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Set Start 1' })).toBeEnabled();
    expect(waveformLoader.load).not.toHaveBeenCalled();
  });

  it('keeps the compact audio panel outside the marker scroller and renders seven rows', async () => {
    const screen = await renderPreparedEditor();

    expect(screen.getByText('00:04 / 01:30')).toBeTruthy();
    expect(screen.queryByText('Editor playback: 1.0x')).toBeNull();
    expect(screen.getByTestId('segment-editor-audio-panel')).toBeTruthy();
    expect(
      within(screen.getByTestId('segment-editor-segment-scroll')).queryByTestId(
        'segment-editor-audio-panel',
      ),
    ).toBeNull();
    for (let start = 1; start <= 6; start += 1) {
      expect(screen.getByLabelText(`Start ${start}`)).toBeTruthy();
    }
    expect(screen.getByLabelText('Final End')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('captures the latest synchronous position as exact integer milliseconds and clamps it', async () => {
    const screen = await renderPreparedEditor();

    mockGetCurrentPositionMs.mockReturnValueOnce(10_349.6);
    await fireEvent.press(screen.getByRole('button', { name: 'Set Start 3' }));
    expect(screen.getByText('Start 3 set to 00:10')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    mockGetCurrentPositionMs.mockReturnValueOnce(PROJECT.durationMs + 1_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Set Final End' }));
    expect(screen.getByText('Final End set to 01:30')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdatePracticeMarkers).toHaveBeenCalledTimes(1));
    expect(mockUpdatePracticeMarkers.mock.calls[0]?.[1]).toEqual({
      startMs: [0, 5_000, 10_350, null, null, null],
      finalEndMs: PROJECT.durationMs,
    });
  });

  it('highlights non-increasing markers and clears only the selected point', async () => {
    const screen = await renderPreparedEditor();

    mockGetCurrentPositionMs.mockReturnValueOnce(18_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Set Start 3' }));
    mockGetCurrentPositionMs.mockReturnValueOnce(20_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Set Start 2' }));

    expect(screen.getByText('Each marker must be later than the previous marker.')).toBeTruthy();
    expect(screen.getByTestId('practice-marker-row-start-3')).toHaveStyle({ borderWidth: 2 });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear Start 3' }));
    expect(screen.queryByText('Each marker must be later than the previous marker.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    mockGetCurrentPositionMs.mockReturnValueOnce(30_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Set Start 3' }));

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('pauses on drag, sends throttled previews, and resumes only after the exact final seek', async () => {
    mockSnapshot = { ...READY_SNAPSHOT, status: 'playing' };
    const screen = await renderPreparedEditor();

    await fireEvent.press(screen.getByLabelText('Scrub start'));
    await fireEvent.press(screen.getByLabelText('Scrub preview'));
    await fireEvent.press(screen.getByLabelText('Scrub finish'));

    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockSeekEditor).toHaveBeenNthCalledWith(1, 45_000, false);
    expect(mockSeekEditor).toHaveBeenNthCalledWith(2, 55_000, true);
  });

  it('resumes prior editor playback when Android cancels a drag', async () => {
    mockSnapshot = { ...READY_SNAPSHOT, status: 'playing' };
    const screen = await renderPreparedEditor();

    await fireEvent.press(screen.getByLabelText('Scrub start'));
    await fireEvent.press(screen.getByLabelText('Scrub cancel'));

    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockPlayEditor).toHaveBeenCalledTimes(1);
  });

  it('uses one dirty-draft discard flow for Android back and leaves persisted data unchanged', async () => {
    const screen = await renderPreparedEditor();
    mockGetCurrentPositionMs.mockReturnValueOnce(30_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Set Start 4' }));

    const action = { type: 'GO_BACK' };
    await act(async () => {
      mockPreventRemoveCallback?.({ data: { action } });
    });
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Incomplete changes cannot be saved',
      expect.stringContaining('Discard the entire draft'),
      expect.any(Array),
      expect.objectContaining({ cancelable: true, onDismiss: expect.any(Function) }),
    );
    expect(mockNavigationDispatch).not.toHaveBeenCalled();

    const dismissOptions = jest.mocked(Alert.alert).mock.calls.at(-1)?.[3];
    await act(async () => {
      dismissOptions?.onDismiss?.();
      mockPreventRemoveCallback?.({ data: { action } });
    });
    expect(Alert.alert).toHaveBeenCalledTimes(2);

    await pressLatestAlertButton('Discard and Exit');
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockDeactivate).toHaveBeenCalledTimes(1);
    expect(mockNavigationDispatch).toHaveBeenCalledWith(action);
    expect(mockUpdatePracticeMarkers).not.toHaveBeenCalled();
  });

  it('pauses, atomically saves a deep copy, invalidates preparation, and returns to practice', async () => {
    const screen = await renderPreparedEditor();
    mockGetCurrentPositionMs.mockReturnValueOnce(30_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Set Start 3' }));
    mockGetCurrentPositionMs.mockReturnValueOnce(40_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Set Start 4' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdatePracticeMarkers).toHaveBeenCalledTimes(1);
      expect(mockDeactivate).toHaveBeenCalledTimes(1);
      expect(mockRouterBack).toHaveBeenCalledTimes(1);
      expect(mockNavigationDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
    });
    expect(mockPause).toHaveBeenCalledTimes(1);
    const saved = mockUpdatePracticeMarkers.mock.calls[0]?.[1];
    expect(saved).not.toBe(PROJECT.practiceMarkers);
    expect(saved?.startMs).not.toBe(PROJECT.practiceMarkers.startMs);
    expect(saved).toEqual({
      startMs: [0, 5_000, 30_000, 40_000, null, null],
      finalEndMs: 90_000,
    });
  });

  it('routes a clean Cancel through the same removal guard and pauses first', async () => {
    const screen = await renderPreparedEditor();

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockNavigationDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('returns a deep-linked successful save to the Project practice route', async () => {
    mockRouteParams = { projectId: PROJECT.id };
    const screen = await renderPreparedEditor();

    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith({
        pathname: '/project/[projectId]',
        params: { projectId: PROJECT.id },
      });
    });
  });
});

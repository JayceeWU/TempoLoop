import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { WaveformScrubber } from '@/components/WaveformScrubber';

function gestureEvent(locationX: number, timeStamp = 1) {
  return {
    nativeEvent: {
      locationX,
    },
    touchHistory: {
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: timeStamp,
      numberActiveTouches: 1,
      touchBank: [
        {
          currentPageX: locationX,
          currentPageY: 0,
          currentTimeStamp: timeStamp,
          previousPageX: locationX,
          previousPageY: 0,
          previousTimeStamp: timeStamp - 1,
          startPageX: locationX,
          startPageY: 0,
          startTimeStamp: 0,
          touchActive: true,
        },
      ],
    },
  };
}

function pinchGestureEvent(leftX: number, rightX: number, timeStamp = 1) {
  const touches = [leftX, rightX].map((locationX, identifier) => ({
    identifier,
    locationX,
    locationY: 0,
    pageX: locationX,
    pageY: 0,
    target: 1,
    timestamp: timeStamp,
  }));

  return {
    nativeEvent: {
      locationX: (leftX + rightX) / 2,
      touches,
    },
    touchHistory: {
      indexOfSingleActiveTouch: -1,
      mostRecentTimeStamp: timeStamp,
      numberActiveTouches: 2,
      touchBank: touches.map((touch) => ({
        currentPageX: touch.pageX,
        currentPageY: touch.pageY,
        currentTimeStamp: timeStamp,
        previousPageX: touch.pageX,
        previousPageY: touch.pageY,
        previousTimeStamp: timeStamp - 1,
        startPageX: touch.pageX,
        startPageY: touch.pageY,
        startTimeStamp: 0,
        touchActive: true,
      })),
    },
  };
}

type RenderResult = Awaited<ReturnType<typeof render>>;
type RenderedElement = ReturnType<RenderResult['getByTestId']>;

async function layoutWaveform(scrubber: RenderedElement, width: number) {
  await act(async () => {
    scrubber.props.onLayout({
      nativeEvent: {
        layout: {
          width,
          height: 72,
          x: 0,
          y: 0,
        },
      },
    });
  });
}

async function layoutOverview(overview: RenderedElement, width: number) {
  await act(async () => {
    overview.props.onLayout({
      nativeEvent: {
        layout: {
          width,
          height: 22,
          x: 0,
          y: 0,
        },
      },
    });
  });
}

describe('WaveformScrubber', () => {
  const amplitudes = Array.from({ length: 2048 }, (_, index) => (index % 3 === 0 ? 1 : 0.25));

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders compact paths, a 30-second viewport, and one overview window', async () => {
    const screen = await render(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={30_000}
        durationMs={120_000}
        onSeekRequested={jest.fn()}
      />,
    );
    const scrubber = screen.getByTestId('waveform-scrubber');
    const overview = screen.getByTestId('waveform-overview');

    await layoutWaveform(scrubber, 1_500);
    await layoutOverview(overview, 300);

    expect(
      screen.getByTestId('waveform-upper-path', { includeHiddenElements: true }).props.d,
    ).toContain('M0 36.00');
    expect(
      screen.getByTestId('waveform-lower-path', { includeHiddenElements: true }).props.d,
    ).toContain('M0 36.00');
    expect(screen.queryAllByTestId(/^waveform-bar-/)).toHaveLength(0);
    expect(
      screen.getByTestId('waveform-playhead', {
        includeHiddenElements: true,
      }).props.x1,
    ).toBe(1_500);
    expect(
      screen.getByTestId('waveform-overview-window', { includeHiddenElements: true }).props,
    ).toEqual(expect.objectContaining({ x: 0, width: 75 }));
    expect(scrubber.props.accessibilityLabel).toBe(
      'Waveform position 0:30 of 2:00. Showing 0:00 to 0:30.',
    );
  });

  test('can render only the upper path', async () => {
    const screen = await render(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={0}
        durationMs={10_000}
        mirrored={false}
        onSeekRequested={jest.fn()}
      />,
    );
    const scrubber = screen.getByTestId('waveform-scrubber');
    await layoutWaveform(scrubber, 200);

    expect(screen.getByTestId('waveform-upper-path', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('waveform-lower-path', { includeHiddenElements: true })).toBeNull();
  });

  test('keeps feedback local, throttles preview seeks, and sends one exact final seek', async () => {
    const onSeekRequested = jest.fn();
    const onSeekPreview = jest.fn();
    const onScrubStart = jest.fn();
    let nowMs = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const screen = await render(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={10_000}
        durationMs={100_000}
        onScrubStart={onScrubStart}
        onSeekPreview={onSeekPreview}
        onSeekRequested={onSeekRequested}
      />,
    );
    const scrubber = screen.getByTestId('waveform-scrubber');
    await layoutWaveform(scrubber, 300);

    await fireEvent(scrubber, 'responderGrant', gestureEvent(60));
    await fireEvent(scrubber, 'responderMove', gestureEvent(240, 2));
    nowMs += 20;
    await fireEvent(scrubber, 'responderMove', gestureEvent(180, 3));
    nowMs += 80;
    await fireEvent(scrubber, 'responderMove', gestureEvent(210, 4));

    expect(onScrubStart).toHaveBeenCalledTimes(1);
    expect(onSeekRequested).not.toHaveBeenCalled();
    expect(onSeekPreview).toHaveBeenNthCalledWith(1, 24_000);
    expect(onSeekPreview).toHaveBeenNthCalledWith(2, 21_000);
    expect(
      screen.getByTestId('waveform-playhead', {
        includeHiddenElements: true,
      }).props.x1,
    ).toBe(210);

    await fireEvent(scrubber, 'responderRelease', gestureEvent(360));

    expect(onSeekRequested).toHaveBeenCalledTimes(1);
    expect(onSeekRequested).toHaveBeenCalledWith(30_000);
  });

  test('sends one final seek for a tap', async () => {
    const onSeekRequested = jest.fn();
    const screen = await render(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={0}
        durationMs={60_000}
        onSeekRequested={onSeekRequested}
      />,
    );
    const scrubber = screen.getByTestId('waveform-scrubber');
    await layoutWaveform(scrubber, 200);

    await fireEvent(scrubber, 'responderGrant', gestureEvent(50));
    await fireEvent(scrubber, 'responderRelease', gestureEvent(50));

    expect(onSeekRequested).toHaveBeenCalledTimes(1);
    expect(onSeekRequested).toHaveBeenCalledWith(7_500);
  });

  test('notifies the editor when Android terminates a drag', async () => {
    const onScrubCancel = jest.fn();
    const onSeekRequested = jest.fn();
    const screen = await render(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={10_000}
        durationMs={100_000}
        onScrubCancel={onScrubCancel}
        onSeekRequested={onSeekRequested}
      />,
    );
    const scrubber = screen.getByTestId('waveform-scrubber');
    await layoutWaveform(scrubber, 300);

    await fireEvent(scrubber, 'responderGrant', gestureEvent(60));
    await fireEvent(scrubber, 'responderTerminate', gestureEvent(120));

    expect(onScrubCancel).toHaveBeenCalledTimes(1);
    expect(onSeekRequested).not.toHaveBeenCalled();
  });

  test('supports one-second adjustable actions with boundary clamping', async () => {
    const onSeekRequested = jest.fn();
    const screen = await render(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={500}
        durationMs={60_000}
        onSeekRequested={onSeekRequested}
      />,
    );
    const scrubber = screen.getByLabelText(/Waveform position/);
    await layoutWaveform(scrubber, 200);

    await fireEvent(scrubber, 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    await fireEvent(scrubber, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });

    expect(onSeekRequested).toHaveBeenNthCalledWith(1, 0);
    expect(onSeekRequested).toHaveBeenNthCalledWith(2, 1_500);
    expect(scrubber.props.accessibilityActions).toEqual([
      { name: 'decrement', label: '-1 second' },
      { name: 'increment', label: '+1 second' },
    ]);
  });

  test('pans the visible window through the draggable overview without seeking audio', async () => {
    const onSeekRequested = jest.fn();
    const screen = await render(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={0}
        durationMs={120_000}
        onSeekRequested={onSeekRequested}
      />,
    );
    const scrubber = screen.getByTestId('waveform-scrubber');
    const overview = screen.getByTestId('waveform-overview');
    await layoutWaveform(scrubber, 300);
    await layoutOverview(overview, 200);

    await fireEvent(overview, 'responderGrant', gestureEvent(150));
    expect(
      screen.getByTestId('waveform-overview-window', { includeHiddenElements: true }).props.x,
    ).toBe(125);
    await fireEvent(overview, 'responderMove', gestureEvent(220));
    expect(
      screen.getByTestId('waveform-overview-window', { includeHiddenElements: true }).props.x,
    ).toBe(150);
    expect(onSeekRequested).not.toHaveBeenCalled();
  });

  test('pinch-zooms around the focal time and stops at the 10-second minimum', async () => {
    const screen = await render(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={0}
        durationMs={120_000}
        onSeekRequested={jest.fn()}
      />,
    );
    const scrubber = screen.getByTestId('waveform-scrubber');
    const overview = screen.getByTestId('waveform-overview');
    await layoutWaveform(scrubber, 300);
    await layoutOverview(overview, 200);

    await fireEvent(scrubber, 'responderGrant', pinchGestureEvent(75, 225));
    await fireEvent(scrubber, 'responderMove', pinchGestureEvent(25, 275, 2));

    const window = screen.getByTestId('waveform-overview-window', {
      includeHiddenElements: true,
    });
    expect(window.props.width).toBeCloseTo(30);
    expect(window.props.x).toBeCloseTo(10);
  });

  test('automatically follows playback after the playhead leaves the viewport', async () => {
    const screen = await render(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={29_000}
        durationMs={120_000}
        onSeekRequested={jest.fn()}
      />,
    );
    await layoutWaveform(screen.getByTestId('waveform-scrubber'), 300);
    await layoutOverview(screen.getByTestId('waveform-overview'), 200);

    await screen.rerender(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={31_000}
        durationMs={120_000}
        isPlaying
        onSeekRequested={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('waveform-overview-window', { includeHiddenElements: true }).props.x,
      ).toBeCloseTo(44.17, 1);
    });
  });

  test('disables touch and accessibility seeks for invalid input or disabled state', async () => {
    const onSeekRequested = jest.fn();
    const screen = await render(
      <WaveformScrubber
        amplitudes={[0, Number.NaN]}
        currentTimeMs={Number.NaN}
        disabled
        durationMs={60_000}
        onSeekRequested={onSeekRequested}
      />,
    );
    const scrubber = screen.getByTestId('waveform-scrubber');
    await layoutWaveform(scrubber, 200);

    expect(screen.queryByTestId('waveform-upper-path', { includeHiddenElements: true })).toBeNull();
    expect(scrubber.props.accessibilityState).toEqual({ disabled: true });

    await fireEvent(scrubber, 'responderGrant', gestureEvent(50));
    await fireEvent(scrubber, 'responderRelease', gestureEvent(50));
    await fireEvent(scrubber, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });

    expect(onSeekRequested).not.toHaveBeenCalled();
  });
});

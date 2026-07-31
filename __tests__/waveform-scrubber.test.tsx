import { act, fireEvent, render } from '@testing-library/react-native';

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

type RenderResult = Awaited<ReturnType<typeof render>>;
type RenderedElement = ReturnType<RenderResult['getByTestId']>;

async function layoutWaveform(scrubber: RenderedElement, width: number) {
  await act(async () => {
    scrubber.props.onLayout({
      nativeEvent: {
        layout: {
          width,
          height: 112,
          x: 0,
          y: 0,
        },
      },
    });
  });
}

describe('WaveformScrubber', () => {
  const amplitudes = Array.from({ length: 2048 }, (_, index) => (index % 3 === 0 ? 1 : 0.25));

  test('renders a measured-width bar count capped at 400 with a native-time playhead', async () => {
    const screen = await render(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={30_000}
        durationMs={120_000}
        onSeekRequested={jest.fn()}
      />,
    );
    const scrubber = screen.getByTestId('waveform-scrubber');

    await layoutWaveform(scrubber, 1_500);

    expect(
      screen.getAllByTestId(/^waveform-bar-/, {
        includeHiddenElements: true,
      }),
    ).toHaveLength(400);
    expect(
      screen.getByTestId('waveform-playhead', {
        includeHiddenElements: true,
      }).props.x1,
    ).toBe(375);
    expect(scrubber.props.accessibilityLabel).toBe('Waveform position 0:30 of 2:00');
  });

  test('keeps drag feedback local and sends one clamped seek at release', async () => {
    const onSeekRequested = jest.fn();
    const screen = await render(
      <WaveformScrubber
        amplitudes={amplitudes}
        currentTimeMs={10_000}
        durationMs={100_000}
        onSeekRequested={onSeekRequested}
      />,
    );
    const scrubber = screen.getByTestId('waveform-scrubber');
    await layoutWaveform(scrubber, 300);

    await fireEvent(scrubber, 'responderGrant', gestureEvent(60));
    await fireEvent(scrubber, 'responderMove', gestureEvent(240, 2));

    expect(onSeekRequested).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('waveform-playhead', {
        includeHiddenElements: true,
      }).props.x1,
    ).toBe(240);

    await fireEvent(scrubber, 'responderRelease', gestureEvent(360));

    expect(onSeekRequested).toHaveBeenCalledTimes(1);
    expect(onSeekRequested).toHaveBeenCalledWith(100_000);
  });

  test('sends one seek for a tap', async () => {
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
    expect(onSeekRequested).toHaveBeenCalledWith(15_000);
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
    const scrubber = screen.getByRole('adjustable');
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

  test('disables touch and accessibility seeks for invalid finite inputs or disabled state', async () => {
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

    expect(
      screen.queryAllByTestId(/^waveform-bar-/, {
        includeHiddenElements: true,
      }),
    ).toHaveLength(0);
    expect(scrubber.props.accessibilityState).toEqual({ disabled: true });

    await fireEvent(scrubber, 'responderGrant', gestureEvent(50));
    await fireEvent(scrubber, 'responderRelease', gestureEvent(50));
    await fireEvent(scrubber, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });

    expect(onSeekRequested).not.toHaveBeenCalled();
  });
});

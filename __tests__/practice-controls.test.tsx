import { fireEvent, render, within } from '@testing-library/react-native';

import { PlaybackButton } from '@/components/PlaybackButton';
import { SegmentGrid } from '@/components/SegmentGrid';
import { SpeedSelector } from '@/components/SpeedSelector';
import { colors } from '@/constants/theme';
import type { DanceSegments } from '@/domain/segment';

const SEGMENTS: DanceSegments = [
  { id: 'segment-1', index: 0, startMs: 8_000, endMs: 20_000 },
  { id: 'segment-2', index: 1, startMs: 20_000, endMs: 30_000 },
  { id: 'segment-3', index: 2, startMs: null, endMs: null },
  { id: 'segment-4', index: 3, startMs: null, endMs: null },
  { id: 'segment-5', index: 4, startMs: null, endMs: null },
  { id: 'segment-6', index: 5, startMs: null, endMs: null },
  { id: 'segment-7', index: 6, startMs: null, endMs: null },
  { id: 'segment-8', index: 7, startMs: null, endMs: null },
  { id: 'segment-9', index: 8, startMs: null, endMs: null },
];

describe('practice controls', () => {
  it('renders five equal speed buttons with a minimum 60 point height', async () => {
    const onSelectRate = jest.fn();
    const screen = await render(<SpeedSelector onSelectRate={onSelectRate} selectedRate={0.9} />);

    const speedButtons = screen.getAllByRole('radio');
    expect(speedButtons).toHaveLength(5);
    speedButtons.forEach((button) => {
      expect(button).toHaveStyle({
        flex: 1,
        minHeight: 60,
      });
    });
    expect(
      screen.getByRole('radio', {
        name: '0.9x speed',
      }).props.accessibilityState,
    ).toMatchObject({ checked: true });

    await fireEvent.press(
      screen.getByRole('radio', {
        name: '0.6x speed',
      }),
    );
    expect(onSelectRate).toHaveBeenCalledWith(0.6);
  });

  it('renders compact three-by-three segment cards and disables invalid segments', async () => {
    const onSelectSegment = jest.fn();
    const screen = await render(
      <SegmentGrid
        durationMs={60_000}
        onSelectSegment={onSelectSegment}
        segments={[
          { id: 'segment-1', index: 0, startMs: 8_000, endMs: 20_000 },
          { id: 'segment-2', index: 1, startMs: 20_000, endMs: null },
          { id: 'segment-3', index: 2, startMs: 30_000, endMs: 30_000 },
          { id: 'segment-4', index: 3, startMs: null, endMs: null },
          { id: 'segment-5', index: 4, startMs: null, endMs: null },
          { id: 'segment-6', index: 5, startMs: null, endMs: null },
          { id: 'segment-7', index: 6, startMs: null, endMs: null },
          { id: 'segment-8', index: 7, startMs: null, endMs: null },
          { id: 'segment-9', index: 8, startMs: null, endMs: null },
        ]}
        selectedSegment={0}
      />,
    );

    const segmentButtons = screen.getAllByRole('button');
    expect(segmentButtons).toHaveLength(9);
    expect(screen.queryByText('Segment 1')).toBeNull();

    const configured = screen.getByRole('button', {
      name: /Segment 1/,
    });
    const incomplete = screen.getByRole('button', {
      name: /Segment 2/,
    });
    const invalid = screen.getByRole('button', {
      name: /Segment 3/,
    });
    expect(configured).toBeEnabled();
    expect(configured.props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(incomplete).toBeDisabled();
    expect(invalid).toBeDisabled();
    expect(incomplete).toHaveStyle({
      backgroundColor: colors.disabledBackground,
    });
    expect(configured).toHaveStyle({ minHeight: 76 });
    expect(within(configured).getByText('1')).toHaveStyle({ textAlign: 'center' });
    expect(within(configured).getByText('0:08')).toHaveStyle({
      fontSize: 16,
      lineHeight: 20,
      textAlign: 'center',
    });
    expect(within(configured).getByText('0:20')).toHaveStyle({
      fontSize: 16,
      lineHeight: 20,
      textAlign: 'center',
    });
    expect(within(incomplete).getByText('0:20')).toHaveStyle({ textAlign: 'center' });
    expect(within(incomplete).getByText('--:--')).toHaveStyle({ textAlign: 'center' });
    const separator = screen.getByTestId('segment-1-time-separator');
    expect(separator.props.children).toBe('\u00b7');
    expect(separator).toHaveStyle({
      fontSize: 16,
      lineHeight: 12,
    });
    expect(screen.getByTestId('segment-1-number-divider')).toHaveStyle({
      alignSelf: 'stretch',
      opacity: 0.35,
      width: 1,
    });
    expect(screen.queryByText(/Start|End/)).toBeNull();
    expect(screen.queryByText(/\u2013/)).toBeNull();

    await fireEvent.press(incomplete);
    expect(onSelectSegment).not.toHaveBeenCalled();
    await fireEvent.press(configured);
    expect(onSelectSegment).toHaveBeenCalledWith(0);
  });

  it('does not re-render segment cards when persisted preferences clone equal segment data', async () => {
    const onSelectSegment = jest.fn();
    const screen = await render(
      <SegmentGrid
        durationMs={60_000}
        onSelectSegment={onSelectSegment}
        segments={SEGMENTS}
        selectedSegment={0}
      />,
    );
    const initialStyle = screen.getByRole('button', { name: /Segment 1/ }).props.style;
    const clonedSegments = SEGMENTS.map((segment) => ({ ...segment })) as DanceSegments;

    await screen.rerender(
      <SegmentGrid
        durationMs={60_000}
        onSelectSegment={onSelectSegment}
        segments={clonedSegments}
        selectedSegment={0}
      />,
    );

    expect(screen.getByRole('button', { name: /Segment 1/ }).props.style).toBe(initialStyle);
  });

  it('re-renders only speed buttons whose selected state changes', async () => {
    const onSelectRate = jest.fn();
    const screen = await render(<SpeedSelector onSelectRate={onSelectRate} selectedRate={1} />);
    const originalSelectedStyle = screen.getByRole('radio', {
      name: '1.0x speed',
    }).props.style;
    const nextSelectedStyle = screen.getByRole('radio', {
      name: '0.9x speed',
    }).props.style;
    const unchangedStyle = screen.getByRole('radio', {
      name: '0.6x speed',
    }).props.style;

    await screen.rerender(<SpeedSelector onSelectRate={onSelectRate} selectedRate={0.9} />);

    expect(screen.getByRole('radio', { name: '1.0x speed' }).props.style).not.toBe(
      originalSelectedStyle,
    );
    expect(screen.getByRole('radio', { name: '0.9x speed' }).props.style).not.toBe(
      nextSelectedStyle,
    );
    expect(screen.getByRole('radio', { name: '0.6x speed' }).props.style).toBe(unchangedStyle);
  });

  it('provides a large disabled-aware bottom playback button', async () => {
    const onPress = jest.fn();
    const screen = await render(<PlaybackButton disabled onPress={onPress} playing={false} />);
    const button = screen.getByRole('button', {
      name: 'Play selected segment',
    });

    expect(button).toBeDisabled();
    expect(button).toHaveStyle({
      minHeight: 88,
      minWidth: 88,
    });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows only the silent countdown number and exposes a cancel action', async () => {
    const onPress = jest.fn();
    const screen = await render(
      <PlaybackButton
        countdownRemainingSeconds={5}
        disabled={false}
        onPress={onPress}
        playing={false}
      />,
    );
    const button = screen.getByRole('button', {
      name: 'Starting in 5 seconds. Tap to cancel.',
    });

    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.queryByText('Play')).toBeNull();
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

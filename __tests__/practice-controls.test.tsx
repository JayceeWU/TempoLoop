import { fireEvent, render, within } from '@testing-library/react-native';

import { PlaybackButton } from '@/components/PlaybackButton';
import { SegmentGrid } from '@/components/SegmentGrid';
import { SpeedSelector } from '@/components/SpeedSelector';
import { colors } from '@/constants/theme';
import { derivePracticeRanges, type PracticeRanges } from '@/domain/segment';

const RANGES = derivePracticeRanges(
  {
    startMs: [8_000, 20_000, null, null, null, null],
    finalEndMs: 30_000,
  },
  60_000,
);

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

  it('renders the fixed four-by-three range grid without visible times', async () => {
    const onSelectRange = jest.fn();
    const screen = await render(
      <SegmentGrid onSelectRange={onSelectRange} ranges={RANGES} selectedRange={0} />,
    );

    const rangeButtons = screen.getAllByRole('button');
    expect(rangeButtons).toHaveLength(12);
    expect(screen.getByTestId('practice-range-grid')).toHaveStyle({ height: 248 });
    expect(
      RANGES.map(
        (range) =>
          within(screen.getByTestId(`practice-range-${range.index}`)).getByText(range.label).props
            .children,
      ),
    ).toEqual(['1', '2', '1-2', '3', '4', '3-4', '5', '6', '5-6', '1-4', '3-6', '1-6']);

    const configured = screen.getByRole('button', {
      name: 'Practice range 1, 0:08 to 0:20',
    });
    const unavailable = screen.getByRole('button', {
      name: 'Practice range 3',
    });
    expect(configured).toBeEnabled();
    expect(configured.props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveStyle({
      backgroundColor: colors.disabledBackground,
    });
    expect(configured).toHaveStyle({ minHeight: 48 });
    expect(screen.queryByText('0:08')).toBeNull();
    expect(screen.queryByText('0:20')).toBeNull();

    await fireEvent.press(unavailable);
    expect(onSelectRange).not.toHaveBeenCalled();
    await fireEvent.press(configured);
    expect(onSelectRange).toHaveBeenCalledWith(0);
  });

  it('does not re-render range cards when persisted preferences clone equal range data', async () => {
    const onSelectRange = jest.fn();
    const screen = await render(
      <SegmentGrid onSelectRange={onSelectRange} ranges={RANGES} selectedRange={0} />,
    );
    const initialStyle = screen.getByRole('button', { name: /Practice range 1,/ }).props.style;
    const clonedRanges = RANGES.map((range) => ({ ...range })) as PracticeRanges;

    await screen.rerender(
      <SegmentGrid onSelectRange={onSelectRange} ranges={clonedRanges} selectedRange={0} />,
    );

    expect(screen.getByRole('button', { name: /Practice range 1,/ }).props.style).toBe(
      initialStyle,
    );
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

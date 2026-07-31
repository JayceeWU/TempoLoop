import { fireEvent, render } from '@testing-library/react-native';

import { PlaybackButton } from '@/components/PlaybackButton';
import { SegmentGrid } from '@/components/SegmentGrid';
import { SpeedSelector } from '@/components/SpeedSelector';
import { colors } from '@/constants/theme';

describe('practice controls', () => {
  it('renders four equal speed buttons with a minimum 60 point height', async () => {
    const onSelectRate = jest.fn();
    const screen = await render(<SpeedSelector onSelectRate={onSelectRate} selectedRate={0.9} />);

    const speedButtons = screen.getAllByRole('radio');
    expect(speedButtons).toHaveLength(4);
    speedButtons.forEach((button) => {
      expect(button).toHaveStyle({
        flex: 1,
        minHeight: 60,
      });
    });
    expect(
      screen.getByRole('radio', {
        name: '0.9x playback speed',
      }).props.accessibilityState,
    ).toMatchObject({ checked: true });

    await fireEvent.press(
      screen.getByRole('radio', {
        name: '0.8x playback speed',
      }),
    );
    expect(onSelectRate).toHaveBeenCalledWith(0.8);
  });

  it('renders a fixed six-button grid and disables incomplete or invalid segments', async () => {
    const onSelectSegment = jest.fn();
    const screen = await render(
      <SegmentGrid
        durationMs={60_000}
        onSelectSegment={onSelectSegment}
        segments={[
          { number: 1, startMs: 8_000, endMs: 20_000 },
          { number: 2, startMs: 20_000, endMs: null },
          { number: 3, startMs: 30_000, endMs: 30_000 },
          { number: 4, startMs: null, endMs: null },
          { number: 5, startMs: null, endMs: null },
          { number: 6, startMs: null, endMs: null },
        ]}
        selectedSegment={1}
      />,
    );

    const segmentButtons = screen.getAllByRole('button');
    expect(segmentButtons).toHaveLength(6);

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

    await fireEvent.press(incomplete);
    expect(onSelectSegment).not.toHaveBeenCalled();
    await fireEvent.press(configured);
    expect(onSelectSegment).toHaveBeenCalledWith(1);
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
});

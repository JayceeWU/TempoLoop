import { fireEvent, render } from '@testing-library/react-native';

import { PlaybackButton } from '@/components/PlaybackButton';
import { SegmentGrid } from '@/components/SegmentGrid';
import { SpeedSelector } from '@/components/SpeedSelector';
import { colors } from '@/constants/theme';

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
        name: '0.9x playback speed',
      }).props.accessibilityState,
    ).toMatchObject({ checked: true });

    await fireEvent.press(
      screen.getByRole('radio', {
        name: '0.6x playback speed',
      }),
    );
    expect(onSelectRate).toHaveBeenCalledWith(0.6);
  });

  it('renders a three-by-three numbered grid and disables incomplete or invalid segments', async () => {
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
    expect(screen.getByText('1')).toHaveStyle({ textAlign: 'center' });
    expect(screen.getByText('0:08 – 0:20')).toHaveStyle({ textAlign: 'center' });

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
    expect(onSelectSegment).toHaveBeenCalledWith(0);
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

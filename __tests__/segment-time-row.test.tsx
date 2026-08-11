import { fireEvent, render } from '@testing-library/react-native';

import { SegmentTimeRow } from '@/components/SegmentTimeRow';

describe('practice marker time row', () => {
  it('renders one unset marker time and disables Clear', async () => {
    const screen = await render(
      <SegmentTimeRow
        label="Start 1"
        markerId="start-1"
        onClear={jest.fn()}
        onSet={jest.fn()}
        timeMs={null}
      />,
    );

    expect(screen.getByText('--:--')).toBeTruthy();
    expect(screen.getByTestId('practice-marker-controls-start-1')).toHaveStyle({
      flexDirection: 'row',
    });
    expect(screen.getByText('Start 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear Start 1' })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('routes Set and Clear and announces the exact marker confirmation', async () => {
    const onSet = jest.fn();
    const onClear = jest.fn();
    const screen = await render(
      <SegmentTimeRow
        confirmation="Start 2 set to 00:10"
        label="Start 2"
        markerId="start-2"
        onClear={onClear}
        onSet={onSet}
        timeMs={10_400}
      />,
    );

    expect(screen.getByText('Start 2 set to 00:10')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Set Start 2' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear Start 2' }));

    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('can disable Set while leaving local Clear available', async () => {
    const onClear = jest.fn();
    const screen = await render(
      <SegmentTimeRow
        label="Final End"
        markerId="final-end"
        onClear={onClear}
        onSet={jest.fn()}
        setDisabled
        timeMs={90_000}
      />,
    );

    expect(screen.getByRole('button', { name: 'Set Final End' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear Final End' })).toBeEnabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear Final End' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('marks and explains the first invalid marker without relying on color alone', async () => {
    const screen = await render(
      <SegmentTimeRow
        highlighted
        label="Start 3"
        markerId="start-3"
        onClear={jest.fn()}
        onSet={jest.fn()}
        timeMs={20_000}
        validationMessage="Each marker must be later than the previous marker."
      />,
    );

    expect(screen.getByTestId('practice-marker-row-start-3')).toHaveStyle({ borderWidth: 2 });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Each marker must be later than the previous marker.',
    );
  });
});

import { fireEvent, render } from '@testing-library/react-native';

import { SegmentTimeRow } from '@/components/SegmentTimeRow';

describe('SegmentTimeRow', () => {
  it('renders a consistent unset format and disables Clear for an empty row', async () => {
    const screen = await render(
      <SegmentTimeRow
        durationMs={90_000}
        onClear={jest.fn()}
        onSet={jest.fn()}
        segment={{ number: 1, startMs: null, endMs: null }}
      />,
    );

    expect(screen.getAllByText('--:--.-')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Clear Segment 1' })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a partial row and routes endpoint and clear actions', async () => {
    const onSet = jest.fn();
    const onClear = jest.fn();
    const screen = await render(
      <SegmentTimeRow
        confirmedEndpoint="startMs"
        durationMs={90_000}
        onClear={onClear}
        onSet={onSet}
        segment={{ number: 2, startMs: 10_400, endMs: null }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Set both start and end, or clear this segment.',
    );
    expect(screen.getByText('Start set to 0:10.4')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Set Segment 2 end' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear Segment 2' }));

    expect(onSet).toHaveBeenCalledWith('endMs');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('can disable Set while leaving local Clear available', async () => {
    const onClear = jest.fn();
    const screen = await render(
      <SegmentTimeRow
        durationMs={90_000}
        onClear={onClear}
        onSet={jest.fn()}
        segment={{ number: 3, startMs: 10_000, endMs: null }}
        setDisabled
      />,
    );

    expect(screen.getByRole('button', { name: 'Set Segment 3 start' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set Segment 3 end' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear Segment 3' })).toBeEnabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear Segment 3' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

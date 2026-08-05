import { fireEvent, render } from '@testing-library/react-native';

import { SegmentTimeRow } from '@/components/SegmentTimeRow';

describe('SegmentTimeRow', () => {
  it('renders a consistent unset format and disables Clear for an empty row', async () => {
    const screen = await render(
      <SegmentTimeRow
        durationMs={90_000}
        onClear={jest.fn()}
        onSet={jest.fn()}
        segment={{ id: 'segment-1', index: 0, startMs: null, endMs: null }}
      />,
    );

    expect(screen.getAllByText('--:--')).toHaveLength(2);
    expect(screen.getByTestId('segment-time-controls-0')).toHaveStyle({
      flexDirection: 'row',
    });
    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.getByText('End')).toBeTruthy();
    expect(screen.getByText('Start')).toHaveStyle({ textAlign: 'center' });
    expect(screen.getByText('End')).toHaveStyle({ textAlign: 'center' });
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
        segment={{ id: 'segment-2', index: 1, startMs: 10_400, endMs: null }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Set both start and end, or clear this segment.',
    );
    expect(screen.getByText('Start set to 00:10')).toBeTruthy();

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
        segment={{ id: 'segment-3', index: 2, startMs: 10_000, endMs: null }}
        setDisabled
      />,
    );

    expect(screen.getByRole('button', { name: 'Set Segment 3 start' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set Segment 3 end' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear Segment 3' })).toBeEnabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear Segment 3' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('marks the first invalid row without relying on color alone', async () => {
    const screen = await render(
      <SegmentTimeRow
        durationMs={90_000}
        highlighted
        onClear={jest.fn()}
        onSet={jest.fn()}
        segment={{ id: 'segment-4', index: 3, startMs: 20_000, endMs: 10_000 }}
      />,
    );

    expect(screen.getByTestId('segment-time-row-3')).toHaveStyle({ borderWidth: 2 });
    expect(screen.getByRole('alert')).toHaveTextContent('Start must be earlier than end.');
  });
});

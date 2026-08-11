import { fireEvent, render } from '@testing-library/react-native';

import { LeadInSelector, snapLeadInSeconds } from '@/components/LeadInSelector';

const mockNativeSliderRender = jest.fn();

jest.mock('@expo/ui/community/slider', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockNativeSliderRender(props);
      return ReactModule.createElement(View, props);
    },
  };
});

describe('LeadInSelector', () => {
  beforeEach(() => {
    mockNativeSliderRender.mockClear();
  });

  it.each([
    [-1, 0],
    [0, 0],
    [1, 2_000],
    [2, 2_000],
    [3, 4_000],
    [4, 4_000],
    [5, 6_000],
    [6, 6_000],
    [7, 8_000],
    [8, 8_000],
    [9, 8_000],
  ])('snaps %s seconds to an allowed whole-second value', (seconds, expectedMs) => {
    expect(snapLeadInSeconds(seconds)).toBe(expectedMs);
  });

  it('shows the five integer labels and exposes an adjustable accessibility value', async () => {
    const onSelectLeadIn = jest.fn();
    const screen = await render(
      <LeadInSelector onSelectLeadIn={onSelectLeadIn} selectedLeadInMs={4_000} />,
    );
    const selector = screen.getByRole('adjustable', {
      name: 'Seconds before segment start',
    });

    expect(screen.getByText('0s', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('2s', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('4s', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('6s', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('8s', { includeHiddenElements: true })).toBeTruthy();
    expect(selector.props.accessibilityValue).toEqual({
      min: 0,
      max: 8,
      now: 4,
      text: '4 seconds',
    });

    fireEvent(selector, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(onSelectLeadIn).toHaveBeenCalledWith(6_000);
  });

  it('does not re-render the native slider when its parent passes unchanged props', async () => {
    const onSelectLeadIn = jest.fn();
    const screen = await render(
      <LeadInSelector onSelectLeadIn={onSelectLeadIn} selectedLeadInMs={4_000} />,
    );
    const initialRenderCount = mockNativeSliderRender.mock.calls.length;

    await screen.rerender(
      <LeadInSelector onSelectLeadIn={onSelectLeadIn} selectedLeadInMs={4_000} />,
    );

    expect(mockNativeSliderRender).toHaveBeenCalledTimes(initialRenderCount);

    await screen.rerender(
      <LeadInSelector onSelectLeadIn={onSelectLeadIn} selectedLeadInMs={2_000} />,
    );
    expect(mockNativeSliderRender).toHaveBeenCalledTimes(initialRenderCount + 1);
  });
});

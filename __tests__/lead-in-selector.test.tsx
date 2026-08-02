import { fireEvent, render } from '@testing-library/react-native';

import { LeadInSelector, snapLeadInSeconds } from '@/components/LeadInSelector';

describe('LeadInSelector', () => {
  it.each([
    [-1, 0],
    [0, 0],
    [1, 2_000],
    [2, 2_000],
    [3, 4_000],
    [4, 4_000],
    [5, 6_000],
    [6, 6_000],
    [7, 6_000],
  ])('snaps %s seconds to an allowed whole-second value', (seconds, expectedMs) => {
    expect(snapLeadInSeconds(seconds)).toBe(expectedMs);
  });

  it('shows the four integer labels and exposes an adjustable accessibility value', async () => {
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
    expect(selector.props.accessibilityValue).toEqual({
      min: 0,
      max: 6,
      now: 4,
      text: '4 seconds',
    });

    fireEvent(selector, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(onSelectLeadIn).toHaveBeenCalledWith(6_000);
  });
});

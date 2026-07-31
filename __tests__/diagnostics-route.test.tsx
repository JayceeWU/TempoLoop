import { render } from '@testing-library/react-native';

import DiagnosticsRoute from '../app/diagnostics';

jest.mock('@/services/DiagnosticsService', () => ({
  DEVELOPMENT_DIAGNOSTICS_ENABLED: false,
}));

jest.mock('@/components/DiagnosticsScreen', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    DiagnosticsScreen: () =>
      ReactModule.createElement(ReactNative.Text, null, 'Diagnostics must not render'),
  };
});

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native');
  const Stack = Object.assign(() => null, { Screen: () => null });
  return {
    Redirect: ({ href }: { href: string }) =>
      ReactModule.createElement(ReactNative.Text, { accessibilityLabel: 'redirect target' }, href),
    Stack,
    router: { back: jest.fn() },
  };
});

describe('production diagnostics route guard', () => {
  test('redirects to the home route when development diagnostics are disabled', async () => {
    const screen = await render(<DiagnosticsRoute />);

    expect(screen.getByLabelText('redirect target')).toHaveTextContent('/');
    expect(screen.queryByText('Diagnostics must not render')).toBeNull();
  });
});

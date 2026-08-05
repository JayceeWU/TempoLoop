import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import RootLayout from '../app/_layout';

jest.mock('expo-router', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Stack = Object.assign(
    ({ children }: { children: ReactNode }) => <View testID="root-stack">{children}</View>,
    { Screen: () => null },
  );
  return { Stack };
});

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: ReactNode }) => (
      <View testID="safe-area-provider">{children}</View>
    ),
  };
});

jest.mock('@/playback/AudioPlayerProvider', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AudioPlayerProvider: ({ children }: { children: ReactNode }) => (
      <View testID="audio-player-provider">{children}</View>
    ),
  };
});

describe('root audio ownership', () => {
  it('mounts one AudioPlayerProvider above every routed screen', async () => {
    const screen = await render(<RootLayout />);

    expect(screen.getAllByTestId('audio-player-provider')).toHaveLength(1);
    expect(screen.getByTestId('root-stack')).toBeTruthy();
  });
});

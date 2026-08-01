import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { AudioPlayerProvider } from '@/playback/AudioPlayerProvider';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AudioPlayerProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: colors.background },
            headerBackButtonDisplayMode: 'minimal',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerTitleStyle: { color: colors.text },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="project/[projectId]/index" options={{ headerShown: false }} />
          <Stack.Screen name="project/[projectId]/segments" options={{ headerShown: false }} />
        </Stack>
      </AudioPlayerProvider>
    </SafeAreaProvider>
  );
}

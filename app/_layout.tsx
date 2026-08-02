import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { AudioPlayerProvider } from '@/playback/AudioPlayerProvider';
import { waveformGenerationCoordinator } from '@/services/WaveformGenerationCoordinator';
import { useProjectStore } from '@/stores/useProjectStore';

function WaveformLifecycle() {
  const projects = useProjectStore((state) => state.projects);
  const isInitialized = useProjectStore((state) => state.isInitialized);

  useEffect(() => {
    if (isInitialized) waveformGenerationCoordinator.syncPendingProjects(projects);
  }, [isInitialized, projects]);

  useEffect(() => {
    waveformGenerationCoordinator.setForeground(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => {
      waveformGenerationCoordinator.setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AudioPlayerProvider>
        <WaveformLifecycle />
        <StatusBar style="light" />
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

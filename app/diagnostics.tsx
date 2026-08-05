import { Redirect, Stack } from 'expo-router';

import { DiagnosticsScreen } from '@/components/DiagnosticsScreen';
import { usePlaybackSnapshot } from '@/playback/AudioPlayerProvider';
import { DEVELOPMENT_DIAGNOSTICS_ENABLED } from '@/services/DiagnosticsService';
import { navigateBackOrHome } from '@/utils/navigation';

function EnabledDiagnosticsRoute() {
  const playbackSnapshot = usePlaybackSnapshot();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DiagnosticsScreen onClose={navigateBackOrHome} playbackSnapshot={playbackSnapshot} />
    </>
  );
}

export default function DiagnosticsRoute() {
  if (!DEVELOPMENT_DIAGNOSTICS_ENABLED) {
    return <Redirect href="/" />;
  }

  return <EnabledDiagnosticsRoute />;
}

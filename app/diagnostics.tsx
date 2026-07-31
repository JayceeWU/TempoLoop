import { Redirect, Stack, router } from 'expo-router';

import { DiagnosticsScreen } from '@/components/DiagnosticsScreen';
import { DEVELOPMENT_DIAGNOSTICS_ENABLED } from '@/services/DiagnosticsService';

export default function DiagnosticsRoute() {
  if (!DEVELOPMENT_DIAGNOSTICS_ENABLED) {
    return <Redirect href="/" />;
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DiagnosticsScreen onClose={() => router.back()} />
    </>
  );
}

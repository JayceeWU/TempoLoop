import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { colors, fontSizes, fontWeights, radii, spacing } from '@/constants/theme';

export type ImportDisplayPhase = 'preparing' | 'extracting' | 'waveform' | 'saving';

export interface ImportProgressSheetProps {
  visible: boolean;
  title: string;
  phaseLabel: string;
  keepOpenMessage: string;
  cancelLabel: string;
  progress: number | null;
  isCancelling?: boolean;
  onCancel(): void;
}

function normalizeProgress(progress: number | null): number | null {
  if (progress === null || !Number.isFinite(progress)) {
    return null;
  }
  return Math.min(Math.max(progress, 0), 1);
}

export function ImportProgressSheet({
  visible,
  title,
  phaseLabel,
  keepOpenMessage,
  cancelLabel,
  progress,
  isCancelling = false,
  onCancel,
}: ImportProgressSheetProps) {
  const normalizedProgress = normalizeProgress(progress);
  const percent = normalizedProgress === null ? null : Math.round(normalizedProgress * 100);

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => undefined}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.content}>
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text accessibilityLiveRegion="polite" style={styles.phase}>
              {phaseLabel}
            </Text>

            <View
              accessibilityLabel={
                percent === null ? phaseLabel : `${phaseLabel} ${percent} percent`
              }
              accessibilityRole="progressbar"
              accessibilityValue={percent === null ? undefined : { min: 0, max: 100, now: percent }}
              style={styles.track}
            >
              <View
                style={[styles.fill, { width: `${percent === null ? 12 : Math.max(percent, 2)}%` }]}
              />
            </View>

            <Text style={styles.keepOpen}>{keepOpenMessage}</Text>
            <AppButton
              fullWidth
              label={cancelLabel}
              loading={isCancelling}
              onPress={onCancel}
              variant="secondary"
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSizes.title,
    fontWeight: fontWeights.bold,
  },
  phase: {
    color: colors.text,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.semibold,
    marginTop: spacing.lg,
  },
  track: {
    backgroundColor: colors.disabledBackground,
    borderRadius: radii.pill,
    height: 10,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  fill: {
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    height: '100%',
  },
  keepOpen: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
    lineHeight: 18,
    marginBottom: spacing.lg,
    marginTop: spacing.md,
  },
});

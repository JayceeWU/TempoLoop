import NativeSlider from '@expo/ui/community/slider';
import { type AccessibilityActionEvent, StyleSheet, Text, View } from 'react-native';

import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, spacing } from '@/constants/theme';
import { LEAD_IN_OPTIONS_MS, type LeadInMs } from '@/domain/playback';

export interface LeadInSelectorProps {
  readonly selectedLeadInMs: LeadInMs;
  readonly disabled?: boolean;
  readonly onSelectLeadIn: (leadInMs: LeadInMs) => void;
}

function optionIndex(leadInMs: LeadInMs): number {
  return LEAD_IN_OPTIONS_MS.indexOf(leadInMs);
}

export function snapLeadInSeconds(value: number): LeadInMs {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const index = Math.min(LEAD_IN_OPTIONS_MS.length - 1, Math.max(0, Math.round(value / 2)));
  return LEAD_IN_OPTIONS_MS[index] ?? 0;
}

export function LeadInSelector({
  selectedLeadInMs,
  disabled = false,
  onSelectLeadIn,
}: LeadInSelectorProps) {
  const selectedSeconds = selectedLeadInMs / 1_000;

  const select = (leadInMs: LeadInMs) => {
    if (!disabled && leadInMs !== selectedLeadInMs) {
      onSelectLeadIn(leadInMs);
    }
  };

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    const currentIndex = optionIndex(selectedLeadInMs);
    const offset = event.nativeEvent.actionName === 'increment' ? 1 : -1;
    const nextIndex = Math.min(LEAD_IN_OPTIONS_MS.length - 1, Math.max(0, currentIndex + offset));
    select(LEAD_IN_OPTIONS_MS[nextIndex] ?? selectedLeadInMs);
  };

  return (
    <View
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      accessibilityLabel={COPY.practice.leadInAccessibilityLabel}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      accessibilityValue={{
        min: 0,
        max: 6,
        now: selectedSeconds,
        text: COPY.practice.leadInValue(selectedSeconds),
      }}
      accessible
      onAccessibilityAction={handleAccessibilityAction}
      style={styles.container}
    >
      <NativeSlider
        disabled={disabled}
        maximumTrackTintColor={colors.border}
        maximumValue={6}
        minimumTrackTintColor={colors.accent}
        minimumValue={0}
        onValueChange={(value) => select(snapLeadInSeconds(value))}
        step={2}
        style={styles.slider}
        thumbTintColor={colors.accent}
        value={selectedSeconds}
      />
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.labels}
      >
        {LEAD_IN_OPTIONS_MS.map((leadInMs) => (
          <Text
            key={leadInMs}
            style={[styles.label, leadInMs === selectedLeadInMs && styles.selectedLabel]}
          >
            {`${leadInMs / 1_000}s`}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xxs,
  },
  slider: {
    alignSelf: 'stretch',
    minHeight: 48,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
    fontWeight: fontWeights.medium,
  },
  selectedLabel: {
    color: colors.accent,
    fontWeight: fontWeights.bold,
  },
});

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, radii, spacing } from '@/constants/theme';
import { segmentDisplayNumber, type DanceSegment } from '@/domain/segment';
import { isPracticeSegmentConfigured } from '@/domain/practice';
import { formatSegmentTime } from '@/utils/time';

export interface SegmentButtonProps {
  readonly segment: DanceSegment;
  readonly durationMs: number;
  readonly selected: boolean;
  readonly interactionDisabled?: boolean;
  readonly onPress: () => void;
}

export function SegmentButton({
  segment,
  durationMs,
  selected,
  interactionDisabled = false,
  onPress,
}: SegmentButtonProps) {
  const configured = isPracticeSegmentConfigured(segment, durationMs);
  const disabled = !configured || interactionDisabled;
  const displayNumber = segmentDisplayNumber(segment.index);
  const accessibilityLabel = COPY.practice.segmentLabel(displayNumber);
  const range = configured
    ? `${formatSegmentTime(segment.startMs)} \u2013 ${formatSegmentTime(segment.endMs)}`
    : '--:-- \u2013 --:--';

  return (
    <Pressable
      accessibilityHint={configured ? undefined : COPY.practice.segmentUnavailableHint}
      accessibilityLabel={`${accessibilityLabel}, ${range}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && configured && styles.selectedButton,
        !configured && styles.unconfiguredButton,
        pressed && !disabled && styles.pressedButton,
        interactionDisabled && configured && styles.busyButton,
      ]}
    >
      <View style={styles.content}>
        <Text
          style={[
            styles.label,
            selected && configured && styles.selectedLabel,
            !configured && styles.unconfiguredLabel,
          ]}
        >
          {displayNumber}
        </Text>
        <Text
          style={[
            styles.range,
            selected && configured && styles.selectedRange,
            !configured && styles.unconfiguredLabel,
          ]}
        >
          {range}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: 'center',
    minHeight: 76,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectedButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  unconfiguredButton: {
    backgroundColor: colors.disabledBackground,
    borderColor: colors.disabledBackground,
  },
  pressedButton: {
    backgroundColor: colors.surfacePressed,
  },
  busyButton: {
    opacity: 0.65,
  },
  content: {
    alignItems: 'center',
  },
  label: {
    color: colors.text,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  selectedLabel: {
    color: colors.textOnAccent,
  },
  range: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
    marginTop: spacing.xxs,
    textAlign: 'center',
  },
  selectedRange: {
    color: colors.textOnAccent,
  },
  unconfiguredLabel: {
    color: colors.disabledText,
  },
});

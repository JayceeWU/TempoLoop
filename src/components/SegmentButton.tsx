import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, radii } from '@/constants/theme';
import {
  isPracticeRangeConfigured,
  type PracticeRange,
  type PracticeRangeIndex,
} from '@/domain/segment';
import { formatSegmentTime } from '@/utils/time';

export interface SegmentButtonProps {
  readonly range: PracticeRange;
  readonly selected: boolean;
  readonly interactionDisabled?: boolean;
  readonly onSelectRange: (rangeIndex: PracticeRangeIndex) => void;
}

function SegmentButtonComponent({
  range,
  selected,
  interactionDisabled = false,
  onSelectRange,
}: SegmentButtonProps) {
  const configured = isPracticeRangeConfigured(range);
  const disabled = !configured || interactionDisabled;
  const selectedAndEnabled = selected && !disabled;
  const accessibilityLabel = configured
    ? COPY.practice.rangeConfiguredAccessibilityLabel(
        range.label,
        formatSegmentTime(range.startMs),
        formatSegmentTime(range.endMs),
      )
    : COPY.practice.rangeAccessibilityLabel(range.label);
  const handlePress = useCallback(() => onSelectRange(range.index), [onSelectRange, range.index]);

  return (
    <Pressable
      accessibilityHint={configured ? undefined : COPY.practice.rangeUnavailableHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={handlePress}
      testID={`practice-range-${range.index}`}
      style={({ pressed }) => [
        styles.button,
        selectedAndEnabled && styles.selectedButton,
        disabled && styles.unconfiguredButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <Text
        style={[
          styles.label,
          selectedAndEnabled && styles.selectedText,
          disabled && styles.unconfiguredText,
        ]}
      >
        {range.label}
      </Text>
    </Pressable>
  );
}

function areSegmentButtonPropsEqual(
  previous: SegmentButtonProps,
  next: SegmentButtonProps,
): boolean {
  return (
    previous.range.id === next.range.id &&
    previous.range.index === next.range.index &&
    previous.range.label === next.range.label &&
    previous.range.startMs === next.range.startMs &&
    previous.range.endMs === next.range.endMs &&
    previous.selected === next.selected &&
    (previous.interactionDisabled ?? false) === (next.interactionDisabled ?? false) &&
    previous.onSelectRange === next.onSelectRange
  );
}

export const SegmentButton = memo(SegmentButtonComponent, areSegmentButtonPropsEqual);

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 0,
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
  label: {
    color: colors.text,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  selectedText: {
    color: colors.textOnAccent,
  },
  unconfiguredText: {
    color: colors.disabledText,
  },
});

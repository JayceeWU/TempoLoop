import { memo, useCallback } from 'react';
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
  readonly onSelectSegment: (segmentIndex: DanceSegment['index']) => void;
}

function SegmentButtonComponent({
  segment,
  durationMs,
  selected,
  interactionDisabled = false,
  onSelectSegment,
}: SegmentButtonProps) {
  const configured = isPracticeSegmentConfigured(segment, durationMs);
  const disabled = !configured || interactionDisabled;
  const selectedAndEnabled = selected && configured && !interactionDisabled;
  const displayNumber = segmentDisplayNumber(segment.index);
  const accessibilityLabel = COPY.practice.segmentLabel(displayNumber);
  const startTime = formatSegmentTime(segment.startMs);
  const endTime = formatSegmentTime(segment.endMs);
  const handlePress = useCallback(
    () => onSelectSegment(segment.index),
    [onSelectSegment, segment.index],
  );

  return (
    <Pressable
      accessibilityHint={configured ? undefined : COPY.practice.segmentUnavailableHint}
      accessibilityLabel={`${accessibilityLabel}, ${startTime} to ${endTime}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.button,
        selectedAndEnabled && styles.selectedButton,
        disabled && styles.unconfiguredButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <View style={styles.content}>
        <View style={styles.numberArea}>
          <Text
            style={[
              styles.number,
              selectedAndEnabled && styles.selectedText,
              disabled && styles.unconfiguredText,
            ]}
          >
            {displayNumber}
          </Text>
        </View>
        <View
          style={[
            styles.numberDivider,
            selectedAndEnabled && styles.selectedNumberDivider,
            disabled && styles.unconfiguredNumberDivider,
          ]}
          testID={`segment-${displayNumber}-number-divider`}
        />
        <View style={styles.times}>
          <View style={styles.timeRow}>
            <Text
              style={[
                styles.time,
                selectedAndEnabled && styles.selectedText,
                disabled && styles.unconfiguredText,
              ]}
            >
              {startTime}
            </Text>
          </View>
          <Text
            accessible={false}
            style={[
              styles.timeSeparator,
              selectedAndEnabled && styles.selectedTimeSeparator,
              disabled && styles.unconfiguredTimeSeparator,
            ]}
            testID={`segment-${displayNumber}-time-separator`}
          >
            {'\u00b7'}
          </Text>
          <View style={styles.timeRow}>
            <Text
              style={[
                styles.time,
                selectedAndEnabled && styles.selectedText,
                disabled && styles.unconfiguredText,
              ]}
            >
              {endTime}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function areSegmentButtonPropsEqual(
  previous: SegmentButtonProps,
  next: SegmentButtonProps,
): boolean {
  return (
    previous.segment.id === next.segment.id &&
    previous.segment.index === next.segment.index &&
    previous.segment.startMs === next.segment.startMs &&
    previous.segment.endMs === next.segment.endMs &&
    previous.durationMs === next.durationMs &&
    previous.selected === next.selected &&
    (previous.interactionDisabled ?? false) === (next.interactionDisabled ?? false) &&
    previous.onSelectSegment === next.onSelectSegment
  );
}

export const SegmentButton = memo(SegmentButtonComponent, areSegmentButtonPropsEqual);

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: 'center',
    minHeight: 76,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
    paddingVertical: 0,
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
  content: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  numberArea: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
  },
  numberDivider: {
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    opacity: 0.35,
    width: 1,
  },
  selectedNumberDivider: {
    backgroundColor: colors.textOnAccent,
  },
  unconfiguredNumberDivider: {
    backgroundColor: colors.disabledText,
  },
  number: {
    color: colors.text,
    fontSize: fontSizes.caption,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  times: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flex: 1,
    gap: spacing.xxs,
    justifyContent: 'center',
    minWidth: 0,
  },
  timeRow: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  time: {
    color: colors.textMuted,
    fontSize: fontSizes.body,
    lineHeight: 20,
    textAlign: 'center',
  },
  timeSeparator: {
    color: colors.border,
    fontSize: fontSizes.body,
    lineHeight: 12,
    textAlign: 'center',
  },
  selectedTimeSeparator: {
    color: colors.textOnAccent,
  },
  unconfiguredTimeSeparator: {
    color: colors.disabledText,
  },
  selectedText: {
    color: colors.textOnAccent,
  },
  unconfiguredText: {
    color: colors.disabledText,
  },
});

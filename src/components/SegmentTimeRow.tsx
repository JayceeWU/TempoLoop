import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, minimumTapSize, radii, spacing } from '@/constants/theme';
import type { PracticeMarkerId } from '@/domain/segment';
import { formatEditorTime } from '@/utils/time';

export interface SegmentTimeRowProps {
  readonly markerId: PracticeMarkerId;
  readonly label: string;
  readonly timeMs: number | null;
  readonly disabled?: boolean;
  readonly setDisabled?: boolean;
  readonly highlighted?: boolean;
  readonly confirmation?: string | null;
  readonly validationMessage?: string | null;
  readonly onSet: () => void;
  readonly onClear: () => void;
}

export const SegmentTimeRow = forwardRef<Text, SegmentTimeRowProps>(function SegmentTimeRow(
  {
    markerId,
    label,
    timeMs,
    disabled = false,
    setDisabled = false,
    highlighted = false,
    confirmation = null,
    validationMessage = null,
    onSet,
    onClear,
  },
  ref,
) {
  return (
    <View
      style={[styles.container, highlighted && styles.highlightedContainer]}
      testID={`practice-marker-row-${markerId}`}
    >
      <View style={styles.controlRow} testID={`practice-marker-controls-${markerId}`}>
        <View accessible style={styles.markerValue} accessibilityLabel={label}>
          <Text ref={ref} numberOfLines={1} style={styles.markerLabel}>
            {label}
          </Text>
          <Text numberOfLines={1} style={styles.time}>
            {formatEditorTime(timeMs)}
          </Text>
        </View>

        <AppButton
          accessibilityLabel={COPY.segmentEditor.setMarkerAccessibilityLabel(label)}
          disabled={disabled || setDisabled}
          label={COPY.common.set}
          onPress={onSet}
          size="compact"
          style={styles.actionButton}
          variant="secondary"
        />
        <AppButton
          accessibilityLabel={COPY.segmentEditor.clearMarkerAccessibilityLabel(label)}
          disabled={disabled || timeMs === null}
          label={COPY.common.clear}
          onPress={onClear}
          size="compact"
          style={styles.actionButton}
          variant="ghost"
        />
      </View>

      {confirmation !== null ? (
        <Text accessibilityLiveRegion="polite" style={styles.liveConfirmation}>
          {confirmation}
        </Text>
      ) : null}

      {validationMessage !== null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {validationMessage}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xs,
  },
  highlightedContainer: {
    borderColor: colors.danger,
    borderWidth: 2,
  },
  controlRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  markerValue: {
    flex: 1,
    minWidth: 0,
  },
  markerLabel: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
  },
  time: {
    color: colors.text,
    fontSize: fontSizes.body,
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeights.semibold,
  },
  actionButton: {
    minHeight: minimumTapSize,
    minWidth: 72,
    paddingHorizontal: spacing.xs,
  },
  liveConfirmation: {
    height: 1,
    opacity: 0,
    position: 'absolute',
    width: 1,
  },
  error: {
    color: colors.danger,
    fontSize: fontSizes.caption,
    marginTop: spacing.xxs,
  },
});

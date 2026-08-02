import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, minimumTapSize, radii, spacing } from '@/constants/theme';
import { segmentDisplayNumber, type DanceSegment } from '@/domain/segment';
import { getDraftSegmentIssue, type SegmentEndpoint } from '@/domain/segmentDraft';
import { formatEditorTime } from '@/utils/time';

export interface SegmentTimeRowProps {
  readonly segment: DanceSegment;
  readonly durationMs: number;
  readonly disabled?: boolean;
  readonly setDisabled?: boolean;
  readonly highlighted?: boolean;
  readonly confirmedEndpoint?: SegmentEndpoint | null;
  readonly onSet: (endpoint: SegmentEndpoint) => void;
  readonly onClear: () => void;
}

function validationMessage(segment: DanceSegment, durationMs: number): string | null {
  const issue = getDraftSegmentIssue(segment, durationMs);

  if (issue === 'PARTIAL') {
    return COPY.segmentEditor.partialError;
  }
  if (issue === 'NON_INTEGER') {
    return COPY.segmentEditor.nonIntegerError;
  }
  if (issue === 'OUT_OF_BOUNDS') {
    return COPY.segmentEditor.outOfBoundsError;
  }
  if (issue === 'START_NOT_BEFORE_END') {
    return COPY.segmentEditor.orderError;
  }

  return null;
}

interface EndpointControlProps {
  readonly displayNumber: number;
  readonly endpoint: 'start' | 'end';
  readonly time: number | null;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

function EndpointControl({
  displayNumber,
  endpoint,
  time,
  disabled,
  onPress,
}: EndpointControlProps) {
  const label = endpoint === 'start' ? COPY.segmentEditor.start : COPY.segmentEditor.end;

  return (
    <View style={styles.endpointControl}>
      <View style={styles.endpointValue}>
        <Text numberOfLines={1} style={styles.endpointLabel}>
          {label}
        </Text>
        <Text numberOfLines={1} style={styles.time}>
          {formatEditorTime(time)}
        </Text>
      </View>
      <AppButton
        accessibilityLabel={COPY.segmentEditor.setEndpointAccessibilityLabel(
          displayNumber,
          endpoint,
        )}
        disabled={disabled}
        label={COPY.common.set}
        onPress={onPress}
        size="compact"
        style={styles.setButton}
        variant="secondary"
      />
    </View>
  );
}

export const SegmentTimeRow = forwardRef<Text, SegmentTimeRowProps>(function SegmentTimeRow(
  {
    segment,
    durationMs,
    disabled = false,
    setDisabled = false,
    highlighted = false,
    confirmedEndpoint = null,
    onSet,
    onClear,
  },
  ref,
) {
  const issue = validationMessage(segment, durationMs);
  const isEmpty = segment.startMs === null && segment.endMs === null;
  const displayNumber = segmentDisplayNumber(segment.index);

  return (
    <View
      style={[styles.container, highlighted && styles.highlightedContainer]}
      testID={`segment-time-row-${segment.index}`}
    >
      <View style={styles.controlRow} testID={`segment-time-controls-${segment.index}`}>
        <View
          accessibilityLabel={COPY.segmentEditor.segmentLabel(displayNumber)}
          accessible
          style={styles.segmentBadge}
        >
          <Text ref={ref} style={styles.segmentNumber}>
            {displayNumber}
          </Text>
        </View>

        <EndpointControl
          disabled={disabled || setDisabled}
          displayNumber={displayNumber}
          endpoint="start"
          onPress={() => onSet('startMs')}
          time={segment.startMs}
        />
        <EndpointControl
          disabled={disabled || setDisabled}
          displayNumber={displayNumber}
          endpoint="end"
          onPress={() => onSet('endMs')}
          time={segment.endMs}
        />

        <AppButton
          accessibilityLabel={COPY.segmentEditor.clearAccessibilityLabel(displayNumber)}
          disabled={disabled || isEmpty}
          label="×"
          onPress={onClear}
          size="compact"
          style={styles.clearButton}
          variant="ghost"
        />
      </View>

      {confirmedEndpoint !== null ? (
        <Text accessibilityLiveRegion="polite" style={styles.liveConfirmation}>
          {COPY.segmentEditor.endpointConfirmation(
            confirmedEndpoint === 'startMs' ? 'Start' : 'End',
            formatEditorTime(segment[confirmedEndpoint]),
          )}
        </Text>
      ) : null}

      {issue !== null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {issue}
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
    gap: spacing.xxs,
  },
  segmentBadge: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  segmentNumber: {
    color: colors.text,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.bold,
  },
  endpointControl: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xxs,
    minWidth: 0,
  },
  endpointValue: {
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  endpointLabel: {
    alignSelf: 'stretch',
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
  },
  time: {
    alignSelf: 'stretch',
    color: colors.text,
    fontSize: fontSizes.caption,
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeights.medium,
    textAlign: 'center',
  },
  setButton: {
    minWidth: minimumTapSize,
    paddingHorizontal: spacing.xxs,
  },
  clearButton: {
    minHeight: minimumTapSize,
    minWidth: minimumTapSize,
    paddingHorizontal: spacing.xxs,
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

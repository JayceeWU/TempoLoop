import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, radii, spacing } from '@/constants/theme';
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
      <Text accessibilityRole="header" ref={ref} style={styles.title}>
        {COPY.segmentEditor.segmentLabel(displayNumber)}
      </Text>

      <View style={styles.endpointRow}>
        <Text style={styles.endpointLabel}>{COPY.segmentEditor.start}</Text>
        <Text style={styles.time}>{formatEditorTime(segment.startMs)}</Text>
        <AppButton
          accessibilityLabel={COPY.segmentEditor.setEndpointAccessibilityLabel(
            displayNumber,
            'start',
          )}
          disabled={disabled || setDisabled}
          label={COPY.common.set}
          onPress={() => onSet('startMs')}
          size="regular"
          variant="secondary"
        />
      </View>

      <View style={styles.endpointRow}>
        <Text style={styles.endpointLabel}>{COPY.segmentEditor.end}</Text>
        <Text style={styles.time}>{formatEditorTime(segment.endMs)}</Text>
        <AppButton
          accessibilityLabel={COPY.segmentEditor.setEndpointAccessibilityLabel(
            displayNumber,
            'end',
          )}
          disabled={disabled || setDisabled}
          label={COPY.common.set}
          onPress={() => onSet('endMs')}
          size="regular"
          variant="secondary"
        />
      </View>

      <View style={styles.footer}>
        <AppButton
          accessibilityLabel={COPY.segmentEditor.clearAccessibilityLabel(displayNumber)}
          disabled={disabled || isEmpty}
          label={COPY.common.clear}
          onPress={onClear}
          size="regular"
          variant="ghost"
        />
        {confirmedEndpoint !== null ? (
          <Text accessibilityLiveRegion="polite" style={styles.confirmation}>
            {COPY.segmentEditor.endpointConfirmation(
              confirmedEndpoint === 'startMs' ? 'Start' : 'End',
              formatEditorTime(segment[confirmedEndpoint]),
            )}
          </Text>
        ) : null}
      </View>

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
    gap: spacing.xs,
    padding: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.semibold,
  },
  highlightedContainer: {
    borderColor: colors.danger,
    borderWidth: 2,
  },
  endpointRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  endpointLabel: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
    width: 38,
  },
  time: {
    color: colors.text,
    flex: 1,
    fontSize: fontSizes.body,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  confirmation: {
    color: colors.accent,
    flex: 1,
    fontSize: fontSizes.caption,
    textAlign: 'right',
  },
  error: {
    color: colors.danger,
    fontSize: fontSizes.caption,
  },
});

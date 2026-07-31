import { StyleSheet, View } from 'react-native';

import { spacing } from '@/constants/theme';
import type { DanceSegments, SegmentNumber } from '@/domain/segment';
import { SegmentButton } from '@/components/SegmentButton';

export interface SegmentGridProps {
  readonly segments: DanceSegments;
  readonly durationMs: number;
  readonly selectedSegment: SegmentNumber | null;
  readonly interactionDisabled?: boolean;
  readonly onSelectSegment: (segmentNumber: SegmentNumber) => void;
}

export function SegmentGrid({
  segments,
  durationMs,
  selectedSegment,
  interactionDisabled = false,
  onSelectSegment,
}: SegmentGridProps) {
  return (
    <View style={styles.grid}>
      {[0, 2, 4].map((rowStart) => (
        <View key={rowStart} style={styles.row}>
          {segments.slice(rowStart, rowStart + 2).map((segment) => (
            <SegmentButton
              durationMs={durationMs}
              interactionDisabled={interactionDisabled}
              key={segment.number}
              onPress={() => onSelectSegment(segment.number)}
              segment={segment}
              selected={selectedSegment === segment.number}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});

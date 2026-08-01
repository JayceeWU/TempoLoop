import { StyleSheet, View } from 'react-native';

import { spacing } from '@/constants/theme';
import type { DanceSegments, SegmentIndex } from '@/domain/segment';
import { SegmentButton } from '@/components/SegmentButton';

export interface SegmentGridProps {
  readonly segments: DanceSegments;
  readonly durationMs: number;
  readonly selectedSegment: SegmentIndex | null;
  readonly interactionDisabled?: boolean;
  readonly onSelectSegment: (segmentIndex: SegmentIndex) => void;
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
              key={segment.id}
              onPress={() => onSelectSegment(segment.index)}
              segment={segment}
              selected={selectedSegment === segment.index}
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

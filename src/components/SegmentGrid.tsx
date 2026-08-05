import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DanceSegments, SegmentIndex } from '@/domain/segment';
import { SegmentButton } from '@/components/SegmentButton';

const SEGMENT_ROWS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
] as const;
const SEGMENT_GAP = 10;

export interface SegmentGridProps {
  readonly segments: DanceSegments;
  readonly durationMs: number;
  readonly selectedSegment: SegmentIndex | null;
  readonly interactionDisabled?: boolean;
  readonly onSelectSegment: (segmentIndex: SegmentIndex) => void;
}

function SegmentGridComponent({
  segments,
  durationMs,
  selectedSegment,
  interactionDisabled = false,
  onSelectSegment,
}: SegmentGridProps) {
  return (
    <View style={styles.grid}>
      {SEGMENT_ROWS.map((row) => (
        <View key={row[0]} style={styles.row}>
          {row.map((segmentIndex) => {
            const segment = segments[segmentIndex];
            return (
              <SegmentButton
                durationMs={durationMs}
                interactionDisabled={interactionDisabled}
                key={segment.id}
                onSelectSegment={onSelectSegment}
                segment={segment}
                selected={selectedSegment === segment.index}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

function areSegmentsEqual(previous: DanceSegments, next: DanceSegments): boolean {
  return previous.every((segment, index) => {
    const nextSegment = next[index];
    return (
      segment.id === nextSegment.id &&
      segment.index === nextSegment.index &&
      segment.startMs === nextSegment.startMs &&
      segment.endMs === nextSegment.endMs
    );
  });
}

function areSegmentGridPropsEqual(previous: SegmentGridProps, next: SegmentGridProps): boolean {
  return (
    previous.durationMs === next.durationMs &&
    previous.selectedSegment === next.selectedSegment &&
    (previous.interactionDisabled ?? false) === (next.interactionDisabled ?? false) &&
    previous.onSelectSegment === next.onSelectSegment &&
    areSegmentsEqual(previous.segments, next.segments)
  );
}

export const SegmentGrid = memo(SegmentGridComponent, areSegmentGridPropsEqual);

const styles = StyleSheet.create({
  grid: {
    gap: SEGMENT_GAP,
  },
  row: {
    flexDirection: 'row',
    gap: SEGMENT_GAP,
  },
});

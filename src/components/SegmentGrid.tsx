import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { SegmentButton } from '@/components/SegmentButton';
import type { PracticeRange, PracticeRangeIndex } from '@/domain/segment';

const RANGE_ROWS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [9, 10, 11],
] as const satisfies readonly (readonly PracticeRangeIndex[])[];
const RANGE_GAP = 6;
const RANGE_GRID_HEIGHT = 248;

export interface SegmentGridProps {
  readonly ranges: readonly PracticeRange[];
  readonly selectedRange: PracticeRangeIndex | null;
  readonly interactionDisabled?: boolean;
  readonly onSelectRange: (rangeIndex: PracticeRangeIndex) => void;
}

function SegmentGridComponent({
  ranges,
  selectedRange,
  interactionDisabled = false,
  onSelectRange,
}: SegmentGridProps) {
  return (
    <View style={styles.grid} testID="practice-range-grid">
      {RANGE_ROWS.map((row) => (
        <View key={row[0]} style={styles.row}>
          {row.map((rangeIndex) => {
            const range = ranges[rangeIndex];
            if (range === undefined) {
              return null;
            }
            return (
              <SegmentButton
                interactionDisabled={interactionDisabled}
                key={range.id}
                onSelectRange={onSelectRange}
                range={range}
                selected={selectedRange === range.index}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

function areRangesEqual(
  previous: readonly PracticeRange[],
  next: readonly PracticeRange[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((range, index) => {
      const nextRange = next[index];
      return (
        nextRange !== undefined &&
        range.id === nextRange.id &&
        range.index === nextRange.index &&
        range.label === nextRange.label &&
        range.startMs === nextRange.startMs &&
        range.endMs === nextRange.endMs
      );
    })
  );
}

function areSegmentGridPropsEqual(previous: SegmentGridProps, next: SegmentGridProps): boolean {
  return (
    previous.selectedRange === next.selectedRange &&
    (previous.interactionDisabled ?? false) === (next.interactionDisabled ?? false) &&
    previous.onSelectRange === next.onSelectRange &&
    areRangesEqual(previous.ranges, next.ranges)
  );
}

export const SegmentGrid = memo(SegmentGridComponent, areSegmentGridPropsEqual);

const styles = StyleSheet.create({
  grid: {
    gap: RANGE_GAP,
    height: RANGE_GRID_HEIGHT,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: RANGE_GAP,
  },
});

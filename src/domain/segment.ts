import { SEGMENT_COUNT } from '@/constants/app';

export const SEGMENT_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
export const SEGMENT_IDS = [
  'segment-1',
  'segment-2',
  'segment-3',
  'segment-4',
  'segment-5',
  'segment-6',
  'segment-7',
  'segment-8',
  'segment-9',
] as const;

export type SegmentIndex = (typeof SEGMENT_INDEXES)[number];
export type SegmentId = (typeof SEGMENT_IDS)[number];

export interface DanceSegment {
  id: SegmentId;
  index: SegmentIndex;
  startMs: number | null;
  endMs: number | null;
}

export type DanceSegments = [
  DanceSegment,
  DanceSegment,
  DanceSegment,
  DanceSegment,
  DanceSegment,
  DanceSegment,
  DanceSegment,
  DanceSegment,
  DanceSegment,
];

export type ConfiguredDanceSegment = DanceSegment & {
  startMs: number;
  endMs: number;
};

export type SegmentValidationIssue =
  'PARTIAL' | 'NON_INTEGER' | 'OUT_OF_BOUNDS' | 'START_NOT_BEFORE_END';

export function createEmptySegments(): DanceSegments {
  return SEGMENT_INDEXES.map((index) => ({
    id: SEGMENT_IDS[index],
    index,
    startMs: null,
    endMs: null,
  })) as DanceSegments;
}

export function isSegmentUnset(segment: DanceSegment): boolean {
  return segment.startMs === null && segment.endMs === null;
}

export function getSegmentValidationIssue(
  segment: DanceSegment,
  durationMs: number,
): SegmentValidationIssue | null {
  if (isSegmentUnset(segment)) {
    return null;
  }

  if (segment.startMs === null || segment.endMs === null) {
    return 'PARTIAL';
  }

  if (
    !Number.isInteger(segment.startMs) ||
    !Number.isInteger(segment.endMs) ||
    !Number.isInteger(durationMs)
  ) {
    return 'NON_INTEGER';
  }

  if (durationMs < 0 || segment.startMs < 0 || segment.endMs > durationMs) {
    return 'OUT_OF_BOUNDS';
  }

  if (segment.startMs >= segment.endMs) {
    return 'START_NOT_BEFORE_END';
  }

  return null;
}

export function isSegmentConfigured(
  segment: DanceSegment,
  durationMs: number,
): segment is ConfiguredDanceSegment {
  return !isSegmentUnset(segment) && getSegmentValidationIssue(segment, durationMs) === null;
}

export function isSegmentValid(segment: DanceSegment, durationMs: number): boolean {
  return getSegmentValidationIssue(segment, durationMs) === null;
}

export function areSegmentsValid(
  segments: readonly DanceSegment[],
  durationMs: number,
): segments is DanceSegments {
  return (
    segments.length === SEGMENT_COUNT &&
    SEGMENT_INDEXES.every(
      (index) =>
        segments[index]?.index === index &&
        segments[index]?.id === SEGMENT_IDS[index] &&
        isSegmentValid(segments[index], durationMs),
    )
  );
}

export function segmentDisplayNumber(index: SegmentIndex): number {
  return index + 1;
}

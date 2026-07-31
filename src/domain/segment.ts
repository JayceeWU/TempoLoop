import { SEGMENT_COUNT } from '@/constants/app';

export const SEGMENT_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

export type SegmentNumber = (typeof SEGMENT_NUMBERS)[number];

export interface DanceSegment {
  number: SegmentNumber;
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
];

export type ConfiguredDanceSegment = DanceSegment & {
  startMs: number;
  endMs: number;
};

export type SegmentValidationIssue =
  'PARTIAL' | 'NON_INTEGER' | 'OUT_OF_BOUNDS' | 'START_NOT_BEFORE_END';

export function createEmptySegments(): DanceSegments {
  return SEGMENT_NUMBERS.map((number) => ({
    number,
    startMs: null,
    endMs: null,
  })) as DanceSegments;
}

export function isSegmentUnset(segment: DanceSegment): boolean {
  return segment.startMs === null && segment.endMs === null;
}

export function isSegmentConfigured(segment: DanceSegment): segment is ConfiguredDanceSegment {
  return segment.startMs !== null && segment.endMs !== null;
}

export function getSegmentValidationIssue(
  segment: DanceSegment,
  durationMs: number,
): SegmentValidationIssue | null {
  if (isSegmentUnset(segment)) {
    return null;
  }

  if (!isSegmentConfigured(segment)) {
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

export function isSegmentValid(segment: DanceSegment, durationMs: number): boolean {
  return getSegmentValidationIssue(segment, durationMs) === null;
}

export function areSegmentsValid(
  segments: readonly DanceSegment[],
  durationMs: number,
): segments is DanceSegments {
  return (
    segments.length === SEGMENT_COUNT &&
    SEGMENT_NUMBERS.every(
      (number, index) =>
        segments[index]?.number === number && isSegmentValid(segments[index], durationMs),
    )
  );
}

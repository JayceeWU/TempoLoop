import type {
  DanceSegment,
  DanceSegments,
  SegmentIndex,
  SegmentValidationIssue,
} from '@/domain/segment';
import {
  SEGMENT_IDS,
  SEGMENT_INDEXES,
  areSegmentsValid,
  getSegmentValidationIssue,
} from '@/domain/segment';
import { clampTimeMs } from '@/utils/time';

export type SegmentEndpoint = 'startMs' | 'endMs';

export function createSegmentDraft(segments: readonly DanceSegment[]): DanceSegments {
  if (segments.length !== SEGMENT_INDEXES.length) {
    throw new Error('A segment draft requires exactly six rows.');
  }

  return SEGMENT_INDEXES.map((index) => {
    const segment = segments[index];
    if (segment === undefined || segment.index !== index || segment.id !== SEGMENT_IDS[index]) {
      throw new Error('Segment draft rows must use the fixed segment IDs in index order.');
    }

    return {
      id: segment.id,
      index,
      startMs: segment.startMs,
      endMs: segment.endMs,
    };
  }) as DanceSegments;
}

export function segmentDraftsEqual(
  left: readonly DanceSegment[],
  right: readonly DanceSegment[],
): boolean {
  return (
    left.length === SEGMENT_INDEXES.length &&
    right.length === SEGMENT_INDEXES.length &&
    SEGMENT_INDEXES.every((index) => {
      const leftSegment = left[index];
      const rightSegment = right[index];

      return (
        leftSegment?.id === SEGMENT_IDS[index] &&
        leftSegment.index === index &&
        rightSegment?.id === SEGMENT_IDS[index] &&
        rightSegment.index === index &&
        leftSegment.startMs === rightSegment.startMs &&
        leftSegment.endMs === rightSegment.endMs
      );
    })
  );
}

function replaceSegment(
  draft: DanceSegments,
  segmentIndex: SegmentIndex,
  replacement: DanceSegment,
): DanceSegments {
  return draft.map((segment) =>
    segment.index === segmentIndex ? { ...replacement } : { ...segment },
  ) as DanceSegments;
}

export function setDraftEndpoint(
  draft: DanceSegments,
  segmentIndex: SegmentIndex,
  endpoint: SegmentEndpoint,
  currentTimeMs: number,
  durationMs: number,
): DanceSegments {
  const segment = draft[segmentIndex];
  if (segment === undefined || segment.index !== segmentIndex) {
    throw new Error('The requested segment row does not exist.');
  }

  const currentIntegerMs = clampTimeMs(currentTimeMs, durationMs);

  return replaceSegment(draft, segmentIndex, {
    ...segment,
    [endpoint]: currentIntegerMs,
  });
}

export function clearDraftSegment(draft: DanceSegments, segmentIndex: SegmentIndex): DanceSegments {
  const segment = draft[segmentIndex];
  if (segment === undefined || segment.index !== segmentIndex) {
    throw new Error('The requested segment row does not exist.');
  }

  return replaceSegment(draft, segmentIndex, {
    id: segment.id,
    index: segment.index,
    startMs: null,
    endMs: null,
  });
}

export function getDraftSegmentIssue(
  segment: DanceSegment,
  durationMs: number,
): SegmentValidationIssue | null {
  return getSegmentValidationIssue(segment, durationMs);
}

export function isSegmentDraftSavable(
  draft: readonly DanceSegment[],
  durationMs: number,
): draft is DanceSegments {
  return areSegmentsValid(draft, durationMs);
}

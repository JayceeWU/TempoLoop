import type {
  DanceSegment,
  DanceSegments,
  SegmentNumber,
  SegmentValidationIssue,
} from '@/domain/segment';
import { SEGMENT_NUMBERS, areSegmentsValid, getSegmentValidationIssue } from '@/domain/segment';
import { clampTimeMs, roundToNearest100Ms } from '@/utils/time';

export type SegmentEndpoint = 'startMs' | 'endMs';

export function createSegmentDraft(segments: readonly DanceSegment[]): DanceSegments {
  if (segments.length !== SEGMENT_NUMBERS.length) {
    throw new Error('A segment draft requires exactly six rows.');
  }

  return SEGMENT_NUMBERS.map((number, index) => {
    const segment = segments[index];
    if (segment === undefined || segment.number !== number) {
      throw new Error('Segment draft rows must be numbered 1 through 6.');
    }

    return {
      number,
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
    left.length === SEGMENT_NUMBERS.length &&
    right.length === SEGMENT_NUMBERS.length &&
    SEGMENT_NUMBERS.every((number, index) => {
      const leftSegment = left[index];
      const rightSegment = right[index];

      return (
        leftSegment?.number === number &&
        rightSegment?.number === number &&
        leftSegment.startMs === rightSegment.startMs &&
        leftSegment.endMs === rightSegment.endMs
      );
    })
  );
}

function replaceSegment(
  draft: DanceSegments,
  segmentNumber: SegmentNumber,
  replacement: DanceSegment,
): DanceSegments {
  return draft.map((segment) =>
    segment.number === segmentNumber ? { ...replacement } : { ...segment },
  ) as DanceSegments;
}

export function setDraftEndpoint(
  draft: DanceSegments,
  segmentNumber: SegmentNumber,
  endpoint: SegmentEndpoint,
  currentTimeMs: number,
  durationMs: number,
): DanceSegments {
  const segment = draft.find((candidate) => candidate.number === segmentNumber);
  if (segment === undefined) {
    throw new Error('The requested segment row does not exist.');
  }

  const clamped = clampTimeMs(currentTimeMs, durationMs);
  const rounded = clampTimeMs(roundToNearest100Ms(clamped), durationMs);

  return replaceSegment(draft, segmentNumber, {
    ...segment,
    [endpoint]: rounded,
  });
}

export function clearDraftSegment(
  draft: DanceSegments,
  segmentNumber: SegmentNumber,
): DanceSegments {
  const segment = draft.find((candidate) => candidate.number === segmentNumber);
  if (segment === undefined) {
    throw new Error('The requested segment row does not exist.');
  }

  return replaceSegment(draft, segmentNumber, {
    number: segmentNumber,
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

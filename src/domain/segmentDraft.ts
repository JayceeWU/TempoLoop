import {
  PRACTICE_MARKER_IDS,
  getPracticeMarkersValidationIssue,
  type PracticeMarkerId,
  type PracticeMarkers,
  type PracticeMarkersValidationIssue,
} from '@/domain/segment';
import { clampTimeMs } from '@/utils/time';

function replacePracticeStart(
  startMs: PracticeMarkers['startMs'],
  index: number,
  value: number | null,
): PracticeMarkers['startMs'] {
  return [
    index === 0 ? value : startMs[0],
    index === 1 ? value : startMs[1],
    index === 2 ? value : startMs[2],
    index === 3 ? value : startMs[3],
    index === 4 ? value : startMs[4],
    index === 5 ? value : startMs[5],
  ];
}

export function createPracticeMarkerDraft(markers: PracticeMarkers): PracticeMarkers {
  return {
    startMs: [...markers.startMs] as PracticeMarkers['startMs'],
    finalEndMs: markers.finalEndMs,
  };
}

export function practiceMarkerDraftsEqual(left: PracticeMarkers, right: PracticeMarkers): boolean {
  return (
    left.finalEndMs === right.finalEndMs &&
    left.startMs.every((value, index) => value === right.startMs[index])
  );
}

export function getDraftMarkerValue(
  draft: PracticeMarkers,
  markerId: PracticeMarkerId,
): number | null {
  if (markerId === 'final-end') {
    return draft.finalEndMs;
  }

  const startIndex = PRACTICE_MARKER_IDS.indexOf(markerId);
  if (startIndex < 0 || startIndex >= draft.startMs.length) {
    throw new Error('The requested practice marker does not exist.');
  }

  return draft.startMs[startIndex] ?? null;
}

export function setDraftMarker(
  draft: PracticeMarkers,
  markerId: PracticeMarkerId,
  currentTimeMs: number,
  durationMs: number,
): PracticeMarkers {
  const nextValueMs = clampTimeMs(currentTimeMs, durationMs);
  const next = createPracticeMarkerDraft(draft);

  if (markerId === 'final-end') {
    return { ...next, finalEndMs: nextValueMs };
  }

  const startIndex = PRACTICE_MARKER_IDS.indexOf(markerId);
  if (startIndex < 0 || startIndex >= next.startMs.length) {
    throw new Error('The requested practice marker does not exist.');
  }

  return {
    ...next,
    startMs: replacePracticeStart(next.startMs, startIndex, nextValueMs),
  };
}

export function clearDraftMarker(
  draft: PracticeMarkers,
  markerId: PracticeMarkerId,
): PracticeMarkers {
  const next = createPracticeMarkerDraft(draft);

  if (markerId === 'final-end') {
    return { ...next, finalEndMs: null };
  }

  const startIndex = PRACTICE_MARKER_IDS.indexOf(markerId);
  if (startIndex < 0 || startIndex >= next.startMs.length) {
    throw new Error('The requested practice marker does not exist.');
  }

  return {
    ...next,
    startMs: replacePracticeStart(next.startMs, startIndex, null),
  };
}

export function getPracticeMarkerDraftIssue(
  draft: PracticeMarkers,
  durationMs: number,
): PracticeMarkersValidationIssue | null {
  return getPracticeMarkersValidationIssue(draft, durationMs);
}

export function isPracticeMarkerDraftSavable(draft: PracticeMarkers, durationMs: number): boolean {
  return getPracticeMarkerDraftIssue(draft, durationMs) === null;
}

import {
  clearDraftMarker,
  createPracticeMarkerDraft,
  getDraftMarkerValue,
  getPracticeMarkerDraftIssue,
  isPracticeMarkerDraftSavable,
  practiceMarkerDraftsEqual,
  setDraftMarker,
} from '@/domain/segmentDraft';
import {
  createDefaultPracticeMarkers,
  createEmptyPracticeMarkers,
  type PracticeMarkers,
} from '@/domain/segment';

function startsForCount(count: number): PracticeMarkers['startMs'] {
  return [
    count >= 1 ? 0 : null,
    count >= 2 ? 1_000 : null,
    count >= 3 ? 2_000 : null,
    count >= 4 ? 3_000 : null,
    count >= 5 ? 4_000 : null,
    count >= 6 ? 5_000 : null,
  ];
}

describe('practice marker editor draft', () => {
  it('deep copies all six starts without retaining the saved tuple', () => {
    const saved = createDefaultPracticeMarkers(90_000);
    const draft = createPracticeMarkerDraft(saved);

    expect(draft).toEqual(saved);
    expect(draft).not.toBe(saved);
    expect(draft.startMs).not.toBe(saved.startMs);
  });

  it('captures exact integer milliseconds and clamps to the duration', () => {
    const original = createDefaultPracticeMarkers(10_350);
    const rounded = setDraftMarker(original, 'start-2', 1_049.4, 10_350);
    const clamped = setDraftMarker(rounded, 'final-end', 10_999, 10_350);

    expect(original.startMs[1]).toBeNull();
    expect(rounded.startMs[1]).toBe(1_049);
    expect(clamped.finalEndMs).toBe(10_350);
    expect(getDraftMarkerValue(clamped, 'start-2')).toBe(1_049);
  });

  it('clears only the requested marker without cascading later starts', () => {
    const draft: PracticeMarkers = {
      startMs: [0, 3_000, 7_000, null, null, null],
      finalEndMs: 20_000,
    };

    const cleared = clearDraftMarker(draft, 'start-2');

    expect(cleared.startMs).toEqual([0, null, 7_000, null, null, null]);
    expect(cleared.finalEndMs).toBe(20_000);
    expect(getPracticeMarkerDraftIssue(cleared, 20_000)).toEqual({
      code: 'START_GAP',
      markerId: 'start-2',
    });
  });

  it('accepts every continuous prefix from one through six starts', () => {
    for (let count = 1; count <= 6; count += 1) {
      const draft: PracticeMarkers = {
        startMs: startsForCount(count),
        finalEndMs: count * 1_000,
      };

      expect(isPracticeMarkerDraftSavable(draft, 10_000)).toBe(true);
    }
  });

  it('rejects a missing first start, a gap, missing end, and non-increasing markers', () => {
    const empty = createEmptyPracticeMarkers();
    expect(getPracticeMarkerDraftIssue(empty, 20_000)).toEqual({
      code: 'START_1_REQUIRED',
      markerId: 'start-1',
    });

    const gap: PracticeMarkers = {
      startMs: [0, null, 5_000, null, null, null],
      finalEndMs: 20_000,
    };
    expect(getPracticeMarkerDraftIssue(gap, 20_000)).toEqual({
      code: 'START_GAP',
      markerId: 'start-2',
    });

    const missingEnd: PracticeMarkers = {
      ...createDefaultPracticeMarkers(20_000),
      finalEndMs: null,
    };
    expect(getPracticeMarkerDraftIssue(missingEnd, 20_000)).toEqual({
      code: 'FINAL_END_REQUIRED',
      markerId: 'final-end',
    });

    const reversed: PracticeMarkers = {
      startMs: [0, 4_000, 3_000, null, null, null],
      finalEndMs: 20_000,
    };
    expect(getPracticeMarkerDraftIssue(reversed, 20_000)).toEqual({
      code: 'NOT_STRICTLY_INCREASING',
      markerId: 'start-3',
    });
  });

  it('compares marker values instead of object or tuple identity', () => {
    const first = createDefaultPracticeMarkers(20_000);
    const second = createPracticeMarkerDraft(first);

    expect(practiceMarkerDraftsEqual(first, second)).toBe(true);
    expect(practiceMarkerDraftsEqual(first, setDraftMarker(second, 'start-2', 1_000, 20_000))).toBe(
      false,
    );
  });
});

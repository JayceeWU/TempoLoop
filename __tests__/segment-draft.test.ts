import {
  clearDraftSegment,
  createSegmentDraft,
  isSegmentDraftSavable,
  segmentDraftsEqual,
  setDraftEndpoint,
} from '@/domain/segmentDraft';
import { createEmptySegments, type DanceSegments } from '@/domain/segment';

describe('segment editor draft', () => {
  it('deep copies all six saved rows without retaining segment references', () => {
    const saved = createEmptySegments();
    const draft = createSegmentDraft(saved);

    expect(draft).toEqual(saved);
    expect(draft).not.toBe(saved);
    draft.forEach((segment, index) => {
      expect(segment).not.toBe(saved[index]);
    });
  });

  it('sets one endpoint immutably using nearest 100ms and duration clamping', () => {
    const original = createEmptySegments();
    const rounded = setDraftEndpoint(original, 1, 'startMs', 1_049, 10_350);
    const clamped = setDraftEndpoint(rounded, 1, 'endMs', 10_350, 10_350);

    expect(original[0]).toEqual({
      number: 1,
      startMs: null,
      endMs: null,
    });
    expect(rounded[0]?.startMs).toBe(1_000);
    expect(rounded[0]?.endMs).toBeNull();
    expect(clamped[0]).toEqual({
      number: 1,
      startMs: 1_000,
      endMs: 10_350,
    });
  });

  it('clears both endpoints without changing other rows', () => {
    const draft: DanceSegments = [
      { number: 1, startMs: 1_000, endMs: 2_000 },
      { number: 2, startMs: 3_000, endMs: 4_000 },
      { number: 3, startMs: null, endMs: null },
      { number: 4, startMs: null, endMs: null },
      { number: 5, startMs: null, endMs: null },
      { number: 6, startMs: null, endMs: null },
    ];

    const cleared = clearDraftSegment(draft, 1);

    expect(cleared[0]).toEqual({
      number: 1,
      startMs: null,
      endMs: null,
    });
    expect(cleared[1]).toEqual(draft[1]);
    expect(cleared[1]).not.toBe(draft[1]);
  });

  it('allows overlap but rejects partial and reversed rows', () => {
    const overlapping: DanceSegments = [
      { number: 1, startMs: 1_000, endMs: 8_000 },
      { number: 2, startMs: 4_000, endMs: 10_000 },
      { number: 3, startMs: null, endMs: null },
      { number: 4, startMs: null, endMs: null },
      { number: 5, startMs: null, endMs: null },
      { number: 6, startMs: null, endMs: null },
    ];
    expect(isSegmentDraftSavable(overlapping, 20_000)).toBe(true);

    const partial = setDraftEndpoint(createEmptySegments(), 1, 'startMs', 2_000, 20_000);
    expect(isSegmentDraftSavable(partial, 20_000)).toBe(false);

    const reversed: DanceSegments = [
      { number: 1, startMs: 8_000, endMs: 4_000 },
      { number: 2, startMs: null, endMs: null },
      { number: 3, startMs: null, endMs: null },
      { number: 4, startMs: null, endMs: null },
      { number: 5, startMs: null, endMs: null },
      { number: 6, startMs: null, endMs: null },
    ];
    expect(isSegmentDraftSavable(reversed, 20_000)).toBe(false);
  });

  it('compares draft values instead of array or object identity', () => {
    const first = createEmptySegments();
    const second = createSegmentDraft(first);

    expect(segmentDraftsEqual(first, second)).toBe(true);
    expect(segmentDraftsEqual(first, setDraftEndpoint(second, 2, 'startMs', 1_000, 20_000))).toBe(
      false,
    );
  });
});

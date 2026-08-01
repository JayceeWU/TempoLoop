import {
  clearDraftSegment,
  createSegmentDraft,
  isSegmentDraftSavable,
  segmentDraftsEqual,
  setDraftEndpoint,
} from '@/domain/segmentDraft';
import { createEmptySegments } from '@/domain/segment';

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

  it('captures exact integer milliseconds and clamps to the duration', () => {
    const original = createEmptySegments();
    const rounded = setDraftEndpoint(original, 0, 'startMs', 1_049.4, 10_350);
    const clamped = setDraftEndpoint(rounded, 0, 'endMs', 10_999, 10_350);

    expect(original[0]).toEqual({
      id: 'segment-1',
      index: 0,
      startMs: null,
      endMs: null,
    });
    expect(rounded[0].startMs).toBe(1_049);
    expect(rounded[0].endMs).toBeNull();
    expect(clamped[0]).toEqual({
      id: 'segment-1',
      index: 0,
      startMs: 1_049,
      endMs: 10_350,
    });
  });

  it('clears both endpoints without changing other rows', () => {
    const draft = createEmptySegments();
    draft[0] = { ...draft[0], startMs: 1_000, endMs: 2_000 };
    draft[1] = { ...draft[1], startMs: 3_000, endMs: 4_000 };

    const cleared = clearDraftSegment(draft, 0);

    expect(cleared[0]).toEqual({
      id: 'segment-1',
      index: 0,
      startMs: null,
      endMs: null,
    });
    expect(cleared[1]).toEqual(draft[1]);
    expect(cleared[1]).not.toBe(draft[1]);
  });

  it('allows overlap but rejects partial and reversed rows', () => {
    const overlapping = createEmptySegments();
    overlapping[0] = { ...overlapping[0], startMs: 1_000, endMs: 8_000 };
    overlapping[1] = { ...overlapping[1], startMs: 4_000, endMs: 10_000 };
    expect(isSegmentDraftSavable(overlapping, 20_000)).toBe(true);

    const partial = setDraftEndpoint(createEmptySegments(), 0, 'startMs', 2_000, 20_000);
    expect(isSegmentDraftSavable(partial, 20_000)).toBe(false);

    const reversed = createEmptySegments();
    reversed[0] = { ...reversed[0], startMs: 8_000, endMs: 4_000 };
    expect(isSegmentDraftSavable(reversed, 20_000)).toBe(false);
  });

  it('compares draft values instead of array or object identity', () => {
    const first = createEmptySegments();
    const second = createSegmentDraft(first);

    expect(segmentDraftsEqual(first, second)).toBe(true);
    expect(segmentDraftsEqual(first, setDraftEndpoint(second, 1, 'startMs', 1_000, 20_000))).toBe(
      false,
    );
  });
});

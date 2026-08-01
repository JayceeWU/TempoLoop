import { PLAYBACK_RATES, calculatePlaybackRange } from '@/domain/playback';

describe('calculatePlaybackRange', () => {
  it('clamps the six-second lead-in to zero', () => {
    expect(
      calculatePlaybackRange({
        id: 'segment-1',
        index: 0,
        startMs: 3_000,
        endMs: 8_000,
      }),
    ).toEqual({ playFromMs: 0, stopAtMs: 8_000 });
  });

  it('starts six source-audio seconds before the segment', () => {
    expect(
      calculatePlaybackRange({
        id: 'segment-1',
        index: 0,
        startMs: 63_000,
        endMs: 70_000,
      }),
    ).toEqual({ playFromMs: 57_000, stopAtMs: 70_000 });
  });

  it('does not change the source-timeline lead-in for any playback rate', () => {
    PLAYBACK_RATES.forEach(() => {
      expect(
        calculatePlaybackRange({
          id: 'segment-1',
          index: 0,
          startMs: 20_000,
          endMs: 25_000,
        }),
      ).toEqual({ playFromMs: 14_000, stopAtMs: 25_000 });
    });
  });

  it('rejects an unconfigured segment', () => {
    expect(() =>
      calculatePlaybackRange({
        id: 'segment-1',
        index: 0,
        startMs: null,
        endMs: null,
      }),
    ).toThrow('SEGMENT_NOT_CONFIGURED');
  });
});

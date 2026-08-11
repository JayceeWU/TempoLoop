import {
  LEAD_IN_OPTIONS_MS,
  PLAYBACK_RATES,
  calculatePlaybackRange,
  isLeadInMs,
} from '@/domain/playback';

describe('calculatePlaybackRange', () => {
  it('clamps the six-second lead-in to zero', () => {
    expect(
      calculatePlaybackRange(
        {
          id: 'segment-1',
          index: 0,
          startMs: 3_000,
          endMs: 8_000,
        },
        6_000,
      ),
    ).toEqual({ playFromMs: 0, stopAtMs: 8_000, countdownMs: 3_000 });
  });

  it('starts six source-audio seconds before the segment', () => {
    expect(
      calculatePlaybackRange(
        {
          id: 'segment-1',
          index: 0,
          startMs: 63_000,
          endMs: 70_000,
        },
        6_000,
      ),
    ).toEqual({ playFromMs: 57_000, stopAtMs: 70_000, countdownMs: 0 });
  });

  it('does not change the source-timeline lead-in for any playback rate', () => {
    PLAYBACK_RATES.forEach(() => {
      expect(
        calculatePlaybackRange(
          {
            id: 'segment-1',
            index: 0,
            startMs: 20_000,
            endMs: 25_000,
          },
          6_000,
        ),
      ).toEqual({ playFromMs: 14_000, stopAtMs: 25_000, countdownMs: 0 });
    });
  });

  it('rejects an unconfigured segment', () => {
    expect(() =>
      calculatePlaybackRange(
        {
          id: 'segment-1',
          index: 0,
          startMs: null,
          endMs: null,
        },
        6_000,
      ),
    ).toThrow('SEGMENT_NOT_CONFIGURED');
  });

  it.each([
    [0, 20_000],
    [2_000, 18_000],
    [4_000, 16_000],
    [6_000, 14_000],
    [8_000, 12_000],
  ] as const)('uses the selected %i ms lead-in', (leadInMs, playFromMs) => {
    expect(
      calculatePlaybackRange(
        { id: 'segment-1', index: 0, startMs: 20_000, endMs: 25_000 },
        leadInMs,
      ),
    ).toEqual({ playFromMs, stopAtMs: 25_000, countdownMs: 0 });
  });

  it('accepts only the five whole-second lead-in values', () => {
    expect(LEAD_IN_OPTIONS_MS).toEqual([0, 2_000, 4_000, 6_000, 8_000]);
    expect(LEAD_IN_OPTIONS_MS.every(isLeadInMs)).toBe(true);
    expect(isLeadInMs(-2_000)).toBe(false);
    expect(isLeadInMs(1_000)).toBe(false);
    expect(isLeadInMs(2_500)).toBe(false);
    expect(isLeadInMs(2_000.5)).toBe(false);
    expect(isLeadInMs(8_000)).toBe(true);
    expect(isLeadInMs(10_000)).toBe(false);
  });

  it.each([
    [0, 8_000],
    [3_000, 5_000],
    [8_000, 0],
    [20_000, 0],
  ] as const)('fills the missing eight-second lead-in at start %i', (startMs, countdownMs) => {
    expect(
      calculatePlaybackRange({ id: 'segment-1', index: 0, startMs, endMs: 25_000 }, 8_000),
    ).toEqual({
      playFromMs: Math.max(0, startMs - 8_000),
      stopAtMs: 25_000,
      countdownMs,
    });
  });
});

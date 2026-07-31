import {
  clampTimeMs,
  formatDuration,
  formatEditorTime,
  formatSegmentTime,
  roundToNearest100Ms,
} from '@/utils/time';

describe('time formatting', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [59_999, '0:59'],
    [60_000, '1:00'],
    [63_200, '1:03'],
    [3_600_000, '60:00'],
  ])('formats %i ms as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it('uses the required unset placeholders', () => {
    expect(formatSegmentTime(null)).toBe('--:--');
    expect(formatEditorTime(null)).toBe('--:--.-');
  });

  it.each([
    [0, '0:00.0'],
    [59_999, '0:59.9'],
    [60_000, '1:00.0'],
    [63_200, '1:03.2'],
  ])('formats editor time %i ms as %s', (milliseconds, expected) => {
    expect(formatEditorTime(milliseconds)).toBe(expected);
  });

  it('rounds Set values to the nearest 100 ms and clamps positions', () => {
    expect(roundToNearest100Ms(1_049)).toBe(1_000);
    expect(roundToNearest100Ms(1_050)).toBe(1_100);
    expect(clampTimeMs(-20, 10_000)).toBe(0);
    expect(clampTimeMs(10_020, 10_000)).toBe(10_000);
  });
});

import {
  clampTimeMs,
  formatDuration,
  formatEditorTime,
  formatSegmentTime,
  formatTimeMs,
} from '@/utils/time';

describe('time formatting', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [59_999, '0:59'],
    [60_000, '1:00'],
    [63_200, '1:03'],
    [3_600_000, '60:00'],
  ])('formats compact duration %i ms as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it('uses the required unset placeholder everywhere', () => {
    expect(formatSegmentTime(null)).toBe('--:--');
    expect(formatEditorTime(null)).toBe('--:--');
    expect(formatTimeMs(null)).toBe('--:--');
  });

  it.each([
    [0, '00:00.0'],
    [59_999, '00:59.9'],
    [60_000, '01:00.0'],
    [63_200, '01:03.2'],
    [3_600_000, '60:00.0'],
  ])('formats editor time %i ms as %s', (milliseconds, expected) => {
    expect(formatEditorTime(milliseconds)).toBe(expected);
  });

  it('rounds source positions only to integer milliseconds and clamps them', () => {
    expect(clampTimeMs(1_049.4, 10_000)).toBe(1_049);
    expect(clampTimeMs(1_049.5, 10_000)).toBe(1_050);
    expect(clampTimeMs(-20, 10_000)).toBe(0);
    expect(clampTimeMs(10_020, 10_000)).toBe(10_000);
  });
});

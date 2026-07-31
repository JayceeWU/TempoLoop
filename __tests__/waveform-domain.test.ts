import {
  MAX_WAVEFORM_RENDER_BARS,
  clampWaveformPosition,
  downsampleWaveform,
  getWaveformRenderBarCount,
  waveformPositionFromX,
} from '@/domain/waveform';

describe('waveform domain', () => {
  test('derives a deterministic render count from width with a 400 bar cap', () => {
    expect(getWaveformRenderBarCount(300, 2048)).toBe(100);
    expect(getWaveformRenderBarCount(1_500, 2048)).toBe(MAX_WAVEFORM_RENDER_BARS);
    expect(getWaveformRenderBarCount(300, 12)).toBe(12);
    expect(getWaveformRenderBarCount(2, 2048)).toBe(1);
    expect(getWaveformRenderBarCount(0, 2048)).toBe(0);
  });

  test('uses stable contiguous buckets for maximum downsampling', () => {
    expect(downsampleWaveform([0.1, 0.8, 0.2, 1], 2)).toEqual([0.8, 1]);
    expect(downsampleWaveform([0.1, 0.2, 0.3], 10)).toEqual([0.1, 0.2, 0.3]);
  });

  test('supports deterministic RMS downsampling without non-finite output', () => {
    const result = downsampleWaveform([0, 1, 0.5, 0.5], 2, 'rms');

    expect(result[0]).toBeCloseTo(Math.sqrt(0.5));
    expect(result[1]).toBeCloseTo(0.5);
    result.forEach((amplitude) => {
      expect(Number.isFinite(amplitude)).toBe(true);
      expect(amplitude).toBeGreaterThanOrEqual(0);
      expect(amplitude).toBeLessThanOrEqual(1);
    });
  });

  test('rejects non-finite and out-of-range amplitudes', () => {
    expect(() => downsampleWaveform([0, Number.NaN], 1)).toThrow(RangeError);
    expect(() => downsampleWaveform([Number.POSITIVE_INFINITY], 1)).toThrow(RangeError);
    expect(() => downsampleWaveform([-0.1], 1)).toThrow(RangeError);
    expect(() => downsampleWaveform([1.1], 1)).toThrow(RangeError);
  });

  test('maps touches to clamped integer source positions', () => {
    expect(waveformPositionFromX(-20, 200, 60_000)).toBe(0);
    expect(waveformPositionFromX(50, 200, 60_000)).toBe(15_000);
    expect(waveformPositionFromX(250, 200, 60_000)).toBe(60_000);
    expect(clampWaveformPosition(60_000.6, 60_000)).toBe(60_000);
    expect(clampWaveformPosition(-5, 60_000)).toBe(0);
  });

  test('rejects non-finite geometry and invalid counts', () => {
    expect(() => getWaveformRenderBarCount(Number.NaN, 2048)).toThrow(RangeError);
    expect(() => getWaveformRenderBarCount(300, -1)).toThrow(RangeError);
    expect(() => downsampleWaveform([0], 0.5)).toThrow(RangeError);
    expect(() => waveformPositionFromX(10, 0, 60_000)).toThrow(RangeError);
    expect(() => waveformPositionFromX(Number.POSITIVE_INFINITY, 100, 60_000)).toThrow(RangeError);
  });
});

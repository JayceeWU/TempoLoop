import {
  MAX_WAVEFORM_RENDER_BARS,
  clampWaveformPosition,
  clampWaveformViewport,
  createWaveformPathData,
  createWaveformViewport,
  downsampleWaveform,
  followWaveformPlayhead,
  getWaveformRenderBarCount,
  panWaveformViewportFromOverview,
  sliceWaveformForViewport,
  waveformPositionFromX,
  waveformPositionFromViewportX,
  zoomWaveformViewport,
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

  test('creates a 60-second viewport and handles short tracks', () => {
    expect(createWaveformViewport(120_000)).toEqual({ startMs: 0, durationMs: 60_000 });
    expect(createWaveformViewport(8_000)).toEqual({ startMs: 0, durationMs: 8_000 });
    expect(createWaveformViewport(0)).toEqual({ startMs: 0, durationMs: 0 });
  });

  test('zooms around the focal time and clamps the window to 10-60 seconds', () => {
    const initial = createWaveformViewport(120_000);

    expect(zoomWaveformViewport(initial, 2, 0.5, 120_000)).toEqual({
      startMs: 15_000,
      durationMs: 30_000,
    });
    expect(zoomWaveformViewport(initial, 10, 0.5, 120_000)).toEqual({
      startMs: 25_000,
      durationMs: 10_000,
    });
    expect(
      zoomWaveformViewport({ startMs: 40_000, durationMs: 10_000 }, 0.1, 0.5, 120_000),
    ).toEqual({ startMs: 15_000, durationMs: 60_000 });
  });

  test('maps overview panning and main-waveform seeking through the viewport', () => {
    expect(panWaveformViewportFromOverview(150, 200, 0.5, 30_000, 120_000)).toEqual({
      startMs: 75_000,
      durationMs: 30_000,
    });
    expect(panWaveformViewportFromOverview(300, 200, 0.5, 30_000, 120_000)).toEqual({
      startMs: 90_000,
      durationMs: 30_000,
    });
    expect(
      waveformPositionFromViewportX(50, 200, { startMs: 60_000, durationMs: 30_000 }, 120_000),
    ).toBe(67_500);
  });

  test('slices only visible waveform bins and follows a playhead outside the window', () => {
    const samples = Array.from({ length: 12 }, (_, index) => index / 12);
    expect(
      sliceWaveformForViewport(samples, { startMs: 30_000, durationMs: 30_000 }, 120_000),
    ).toEqual(samples.slice(3, 6));
    expect(followWaveformPlayhead({ startMs: 0, durationMs: 30_000 }, 31_000, 120_000)).toEqual({
      startMs: 26_500,
      durationMs: 30_000,
    });
    expect(
      followWaveformPlayhead({ startMs: 20_000, durationMs: 30_000 }, 30_000, 120_000),
    ).toEqual({ startMs: 20_000, durationMs: 30_000 });
  });

  test('rejects invalid viewport geometry', () => {
    expect(() => clampWaveformViewport({ startMs: 0, durationMs: 20_000 }, -1)).toThrow(RangeError);
    expect(() => zoomWaveformViewport(createWaveformViewport(60_000), 0, 0.5, 60_000)).toThrow(
      RangeError,
    );
    expect(() => panWaveformViewportFromOverview(10, 0, 0.5, 30_000, 60_000)).toThrow(RangeError);
  });

  test('builds one upper path and an optional mirrored lower path', () => {
    const mirrored = createWaveformPathData([0, 0.5, 1], 200, 100, 10);

    expect(mirrored.upper).toBe('M0 50.00 L0.00 50.00 L100.00 30.00 L200.00 10.00 L200.00 50.00 Z');
    expect(mirrored.lower).toBe('M0 50.00 L0.00 50.00 L100.00 70.00 L200.00 90.00 L200.00 50.00 Z');

    const upperOnly = createWaveformPathData([1], 80, 40, 4, false);
    expect(upperOnly.upper).toBe('M0 20.00 L40.00 4.00 L80.00 20.00 Z');
    expect(upperOnly.lower).toBeNull();
  });

  test('rejects invalid path geometry without producing non-finite SVG data', () => {
    expect(() => createWaveformPathData([Number.NaN], 100, 40, 4)).toThrow(RangeError);
    expect(() => createWaveformPathData([0.5], 0, 40, 4)).toThrow(RangeError);
    expect(() => createWaveformPathData([0.5], 100, 40, 20)).toThrow(RangeError);
  });

  test('rejects non-finite geometry and invalid counts', () => {
    expect(() => getWaveformRenderBarCount(Number.NaN, 2048)).toThrow(RangeError);
    expect(() => getWaveformRenderBarCount(300, -1)).toThrow(RangeError);
    expect(() => downsampleWaveform([0], 0.5)).toThrow(RangeError);
    expect(() => waveformPositionFromX(10, 0, 60_000)).toThrow(RangeError);
    expect(() => waveformPositionFromX(Number.POSITIVE_INFINITY, 100, 60_000)).toThrow(RangeError);
  });
});

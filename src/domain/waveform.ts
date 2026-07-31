export const MAX_WAVEFORM_RENDER_BARS = 400;
export const WAVEFORM_BAR_SLOT_WIDTH = 3;

export type WaveformDownsampleMode = 'maximum' | 'rms';

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
}

function assertValidAmplitude(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('Waveform amplitudes must be finite values between 0 and 1.');
  }
}

export function getWaveformRenderBarCount(measuredWidth: number, sourcePointCount: number): number {
  assertFiniteNumber(measuredWidth, 'Measured waveform width');

  if (!Number.isInteger(sourcePointCount) || sourcePointCount < 0) {
    throw new RangeError('Waveform source point count must be a non-negative integer.');
  }

  if (measuredWidth <= 0 || sourcePointCount === 0) {
    return 0;
  }

  return Math.min(
    sourcePointCount,
    MAX_WAVEFORM_RENDER_BARS,
    Math.max(1, Math.floor(measuredWidth / WAVEFORM_BAR_SLOT_WIDTH)),
  );
}

/**
 * Maps contiguous source buckets to one render value each. Bucket boundaries
 * are integer-derived, so the same input and render count always produce the
 * same bars on every device.
 */
export function downsampleWaveform(
  amplitudes: readonly number[],
  requestedBarCount: number,
  mode: WaveformDownsampleMode = 'maximum',
): number[] {
  if (!Number.isInteger(requestedBarCount) || requestedBarCount < 0) {
    throw new RangeError('Waveform render bar count must be a non-negative integer.');
  }

  amplitudes.forEach(assertValidAmplitude);

  if (amplitudes.length === 0 || requestedBarCount === 0) {
    return [];
  }

  const renderBarCount = Math.min(amplitudes.length, requestedBarCount);
  const result = new Array<number>(renderBarCount);

  for (let barIndex = 0; barIndex < renderBarCount; barIndex += 1) {
    const sourceStart = Math.floor((barIndex * amplitudes.length) / renderBarCount);
    const sourceEnd = Math.floor(((barIndex + 1) * amplitudes.length) / renderBarCount);
    let maximum = 0;
    let sumOfSquares = 0;

    for (let sourceIndex = sourceStart; sourceIndex < sourceEnd; sourceIndex += 1) {
      const amplitude = amplitudes[sourceIndex]!;
      maximum = Math.max(maximum, amplitude);
      sumOfSquares += amplitude * amplitude;
    }

    result[barIndex] =
      mode === 'rms' ? Math.sqrt(sumOfSquares / (sourceEnd - sourceStart)) : maximum;
  }

  return result;
}

export function clampWaveformPosition(positionMs: number, durationMs: number): number {
  assertFiniteNumber(positionMs, 'Waveform position');
  assertFiniteNumber(durationMs, 'Waveform duration');

  if (durationMs < 0) {
    throw new RangeError('Waveform duration must be non-negative.');
  }

  return Math.min(durationMs, Math.max(0, Math.round(positionMs)));
}

export function waveformPositionFromX(
  locationX: number,
  measuredWidth: number,
  durationMs: number,
): number {
  assertFiniteNumber(locationX, 'Waveform touch position');
  assertFiniteNumber(measuredWidth, 'Measured waveform width');

  if (measuredWidth <= 0) {
    throw new RangeError('Measured waveform width must be greater than zero.');
  }

  const clampedX = Math.min(measuredWidth, Math.max(0, locationX));
  return clampWaveformPosition((clampedX / measuredWidth) * durationMs, durationMs);
}

export const MAX_WAVEFORM_RENDER_BARS = 400;
export const WAVEFORM_BAR_SLOT_WIDTH = 3;
export const DEFAULT_WAVEFORM_VIEWPORT_MS = 30_000;
export const MIN_WAVEFORM_VIEWPORT_MS = 10_000;

export type WaveformDownsampleMode = 'maximum' | 'rms';

export interface WaveformPathData {
  readonly upper: string;
  readonly lower: string | null;
}

export interface WaveformViewport {
  readonly startMs: number;
  readonly durationMs: number;
}

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

function normalizedTrackDuration(durationMs: number): number {
  assertFiniteNumber(durationMs, 'Waveform duration');
  if (durationMs < 0) {
    throw new RangeError('Waveform duration must be non-negative.');
  }

  return Math.round(durationMs);
}

export function clampWaveformViewport(
  viewport: WaveformViewport,
  totalDurationMs: number,
  minimumDurationMs = MIN_WAVEFORM_VIEWPORT_MS,
  maximumDurationMs = DEFAULT_WAVEFORM_VIEWPORT_MS,
): WaveformViewport {
  const total = normalizedTrackDuration(totalDurationMs);
  assertFiniteNumber(viewport.startMs, 'Waveform viewport start');
  assertFiniteNumber(viewport.durationMs, 'Waveform viewport duration');
  assertFiniteNumber(minimumDurationMs, 'Minimum waveform viewport duration');
  assertFiniteNumber(maximumDurationMs, 'Maximum waveform viewport duration');

  if (minimumDurationMs <= 0 || maximumDurationMs < minimumDurationMs) {
    throw new RangeError('Waveform viewport duration limits are invalid.');
  }
  if (total === 0) {
    return { startMs: 0, durationMs: 0 };
  }

  const minimum = Math.min(total, Math.round(minimumDurationMs));
  const maximum = Math.min(total, Math.round(maximumDurationMs));
  const durationMs = Math.min(maximum, Math.max(minimum, Math.round(viewport.durationMs)));
  const startMs = Math.min(total - durationMs, Math.max(0, Math.round(viewport.startMs)));

  return { startMs, durationMs };
}

export function createWaveformViewport(totalDurationMs: number): WaveformViewport {
  return clampWaveformViewport(
    { startMs: 0, durationMs: DEFAULT_WAVEFORM_VIEWPORT_MS },
    totalDurationMs,
  );
}

export function zoomWaveformViewport(
  viewport: WaveformViewport,
  scale: number,
  focalRatio: number,
  totalDurationMs: number,
): WaveformViewport {
  assertFiniteNumber(scale, 'Waveform zoom scale');
  assertFiniteNumber(focalRatio, 'Waveform zoom focal ratio');
  if (scale <= 0) {
    throw new RangeError('Waveform zoom scale must be greater than zero.');
  }

  const current = clampWaveformViewport(viewport, totalDurationMs);
  if (current.durationMs === 0) {
    return current;
  }

  const ratio = Math.min(1, Math.max(0, focalRatio));
  const focalTimeMs = current.startMs + current.durationMs * ratio;
  const nextDurationMs = clampWaveformViewport(
    { startMs: 0, durationMs: current.durationMs / scale },
    totalDurationMs,
  ).durationMs;

  return clampWaveformViewport(
    {
      startMs: focalTimeMs - nextDurationMs * ratio,
      durationMs: nextDurationMs,
    },
    totalDurationMs,
  );
}

export function panWaveformViewportFromOverview(
  locationX: number,
  measuredWidth: number,
  dragOffsetRatio: number,
  viewportDurationMs: number,
  totalDurationMs: number,
): WaveformViewport {
  assertFiniteNumber(locationX, 'Waveform overview touch position');
  assertFiniteNumber(measuredWidth, 'Measured waveform overview width');
  assertFiniteNumber(dragOffsetRatio, 'Waveform overview drag offset');
  if (measuredWidth <= 0) {
    throw new RangeError('Measured waveform overview width must be greater than zero.');
  }

  const total = normalizedTrackDuration(totalDurationMs);
  if (total === 0) {
    return { startMs: 0, durationMs: 0 };
  }

  const clampedX = Math.min(measuredWidth, Math.max(0, locationX));
  const offset = Math.min(1, Math.max(0, dragOffsetRatio));
  const requestedStartMs = (clampedX / measuredWidth) * total - viewportDurationMs * offset;

  return clampWaveformViewport(
    { startMs: requestedStartMs, durationMs: viewportDurationMs },
    total,
  );
}

export function waveformPositionFromViewportX(
  locationX: number,
  measuredWidth: number,
  viewport: WaveformViewport,
  totalDurationMs: number,
): number {
  assertFiniteNumber(locationX, 'Waveform touch position');
  assertFiniteNumber(measuredWidth, 'Measured waveform width');
  if (measuredWidth <= 0) {
    throw new RangeError('Measured waveform width must be greater than zero.');
  }

  const normalizedViewport = clampWaveformViewport(viewport, totalDurationMs);
  const clampedX = Math.min(measuredWidth, Math.max(0, locationX));
  return clampWaveformPosition(
    normalizedViewport.startMs + (clampedX / measuredWidth) * normalizedViewport.durationMs,
    totalDurationMs,
  );
}

export function sliceWaveformForViewport(
  amplitudes: readonly number[],
  viewport: WaveformViewport,
  totalDurationMs: number,
): number[] {
  amplitudes.forEach(assertValidAmplitude);
  const total = normalizedTrackDuration(totalDurationMs);
  if (amplitudes.length === 0 || total === 0) {
    return [];
  }

  const normalizedViewport = clampWaveformViewport(viewport, total);
  const sourceStart = Math.min(
    amplitudes.length - 1,
    Math.max(0, Math.floor((normalizedViewport.startMs / total) * amplitudes.length)),
  );
  const sourceEnd = Math.min(
    amplitudes.length,
    Math.max(
      sourceStart + 1,
      Math.ceil(
        ((normalizedViewport.startMs + normalizedViewport.durationMs) / total) * amplitudes.length,
      ),
    ),
  );

  return amplitudes.slice(sourceStart, sourceEnd);
}

export function followWaveformPlayhead(
  viewport: WaveformViewport,
  positionMs: number,
  totalDurationMs: number,
): WaveformViewport {
  const current = clampWaveformViewport(viewport, totalDurationMs);
  const position = clampWaveformPosition(positionMs, totalDurationMs);
  const endMs = current.startMs + current.durationMs;

  if (position >= current.startMs && position <= endMs) {
    return current;
  }

  return clampWaveformViewport(
    {
      startMs: position - current.durationMs * 0.15,
      durationMs: current.durationMs,
    },
    totalDurationMs,
  );
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

/**
 * Builds one compact filled path above the center line and, when requested,
 * one mirrored path below it. The caller chooses how many source points to
 * pass in, so drawing stays independent from the persisted 2,048-bin shape.
 */
export function createWaveformPathData(
  amplitudes: readonly number[],
  width: number,
  height: number,
  verticalPadding: number,
  mirrored = true,
): WaveformPathData {
  assertFiniteNumber(width, 'Waveform width');
  assertFiniteNumber(height, 'Waveform height');
  assertFiniteNumber(verticalPadding, 'Waveform vertical padding');
  amplitudes.forEach(assertValidAmplitude);

  if (width <= 0 || height <= 0 || verticalPadding < 0 || verticalPadding * 2 >= height) {
    throw new RangeError('Waveform path geometry is invalid.');
  }

  if (amplitudes.length === 0) {
    return { upper: '', lower: mirrored ? '' : null };
  }

  const centerY = height / 2;
  const availableHalfHeight = centerY - verticalPadding;
  const lastIndex = amplitudes.length - 1;
  const pointX = (index: number): number =>
    lastIndex === 0 ? width / 2 : (index / lastIndex) * width;
  const pointList = (direction: -1 | 1): string =>
    amplitudes
      .map((amplitude, index) => {
        const x = pointX(index);
        const y = centerY + direction * amplitude * availableHalfHeight;
        return `L${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');

  const upper = `M0 ${centerY.toFixed(2)} ${pointList(-1)} L${width.toFixed(2)} ${centerY.toFixed(2)} Z`;
  const lower = mirrored
    ? `M0 ${centerY.toFixed(2)} ${pointList(1)} L${width.toFixed(2)} ${centerY.toFixed(2)} Z`
    : null;

  return { upper, lower };
}

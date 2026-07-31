const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_TENTH = 100;
const SECONDS_PER_MINUTE = 60;

function assertFiniteNonNegativeMilliseconds(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Milliseconds must be a finite non-negative number.');
  }
}

function splitWholeSeconds(milliseconds: number): {
  minutes: number;
  seconds: number;
} {
  assertFiniteNonNegativeMilliseconds(milliseconds);
  const wholeSeconds = Math.floor(milliseconds / MILLISECONDS_PER_SECOND);

  return {
    minutes: Math.floor(wholeSeconds / SECONDS_PER_MINUTE),
    seconds: wholeSeconds % SECONDS_PER_MINUTE,
  };
}

export function formatDuration(milliseconds: number): string {
  const { minutes, seconds } = splitWholeSeconds(milliseconds);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatSegmentTime(milliseconds: number | null): string {
  return milliseconds === null ? '--:--' : formatDuration(milliseconds);
}

export function formatEditorTime(milliseconds: number | null): string {
  if (milliseconds === null) {
    return '--:--.-';
  }

  const { minutes, seconds } = splitWholeSeconds(milliseconds);
  const tenths =
    Math.floor(milliseconds / MILLISECONDS_PER_TENTH) %
    (MILLISECONDS_PER_SECOND / MILLISECONDS_PER_TENTH);

  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}

export function roundToNearest100Ms(milliseconds: number): number {
  assertFiniteNonNegativeMilliseconds(milliseconds);
  return Math.round(milliseconds / MILLISECONDS_PER_TENTH) * MILLISECONDS_PER_TENTH;
}

export function clampTimeMs(milliseconds: number, durationMs: number): number {
  if (!Number.isFinite(milliseconds)) {
    throw new RangeError('Milliseconds must be finite.');
  }
  assertFiniteNonNegativeMilliseconds(durationMs);

  return Math.min(durationMs, Math.max(0, Math.round(milliseconds)));
}

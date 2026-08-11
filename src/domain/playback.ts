import type { DanceSegment } from '@/domain/segment';

export const PLAYBACK_RATES = [1, 0.9, 0.8, 0.7, 0.6] as const;
export const LEAD_IN_OPTIONS_MS = [0, 2_000, 4_000, 6_000, 8_000] as const;

export type PlaybackRate = (typeof PLAYBACK_RATES)[number];
export type LeadInMs = (typeof LEAD_IN_OPTIONS_MS)[number];

export type PlaybackMode = 'idle' | 'editor' | 'practice';

export type PlaybackStatus =
  'idle' | 'loading' | 'ready' | 'countdown' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlaybackSnapshot {
  mode: PlaybackMode;
  status: PlaybackStatus;
  projectId: string | null;
  segmentIndex: number | null;
  sourcePositionMs: number;
  sourceDurationMs: number;
  clipStartMs: number;
  clipEndMs: number | null;
  rate: PlaybackRate;
  countdownRemainingSeconds: number | null;
  commandGeneration: number;
}

export interface PlaybackRange {
  playFromMs: number;
  stopAtMs: number;
  countdownMs: number;
}

export function isPlaybackRate(value: number): value is PlaybackRate {
  return PLAYBACK_RATES.some((rate) => rate === value);
}

export function isLeadInMs(value: number): value is LeadInMs {
  return LEAD_IN_OPTIONS_MS.some((leadInMs) => leadInMs === value);
}

export function calculatePlaybackRange(segment: DanceSegment, leadInMs: LeadInMs): PlaybackRange {
  if (segment.startMs === null || segment.endMs === null) {
    throw new Error('SEGMENT_NOT_CONFIGURED');
  }

  return {
    playFromMs: Math.max(0, segment.startMs - leadInMs),
    stopAtMs: segment.endMs,
    countdownMs: Math.max(0, leadInMs - segment.startMs),
  };
}

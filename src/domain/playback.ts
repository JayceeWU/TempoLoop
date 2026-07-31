import { LEAD_IN_MS } from '@/constants/app';
import type { DanceSegment } from '@/domain/segment';

export const PLAYBACK_RATES = [1, 0.9, 0.8, 0.7] as const;

export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export interface PlaybackRange {
  playFromMs: number;
  stopAtMs: number;
}

export function isPlaybackRate(value: number): value is PlaybackRate {
  return PLAYBACK_RATES.some((rate) => rate === value);
}

export function calculatePlaybackRange(segment: DanceSegment): PlaybackRange {
  if (segment.startMs === null || segment.endMs === null) {
    throw new Error('SEGMENT_NOT_CONFIGURED');
  }

  return {
    playFromMs: Math.max(0, segment.startMs - LEAD_IN_MS),
    stopAtMs: segment.endMs,
  };
}

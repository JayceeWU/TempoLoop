import type { PlaybackRate } from '@/domain/playback';
import type { DanceSegments } from '@/domain/segment';

export interface DanceProject {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
  audioFileName: 'audio.m4a';
  waveformFileName: 'waveform.json';
  durationMs: number;
  sourceDisplayName: string | null;
  sourceSizeBytes: number | null;
  selectedRate: PlaybackRate;
  segments: DanceSegments;
}

export interface StoredWaveform {
  schemaVersion: 1;
  durationMs: number;
  sampleCount: 2048;
  samples: number[];
}

/** Temporary naming compatibility while callers migrate to StoredWaveform. */
export type WaveformFile = StoredWaveform;

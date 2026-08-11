import type { LeadInMs, PlaybackRate } from '@/domain/playback';
import type { DanceSegments, PracticeMarkers } from '@/domain/segment';

export type WaveformStatus = 'pending' | 'ready' | 'failed';

export interface DanceProject {
  schemaVersion: 2;
  id: string;
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
  audioFileName: 'audio.m4a';
  waveformFileName: 'waveform.json';
  waveformStatus: WaveformStatus;
  durationMs: number;
  sourceDisplayName: string | null;
  sourceSizeBytes: number | null;
  selectedRate: PlaybackRate;
  leadInMs: LeadInMs;
  practiceMarkers: PracticeMarkers;
}

/** Validated on-disk representation used only while migrating schema v1. */
export interface LegacyDanceProject {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
  audioFileName: 'audio.m4a';
  waveformFileName: 'waveform.json';
  waveformStatus: WaveformStatus;
  durationMs: number;
  sourceDisplayName: string | null;
  sourceSizeBytes: number | null;
  selectedRate: PlaybackRate;
  leadInMs: LeadInMs;
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

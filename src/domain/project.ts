import type { PlaybackRate } from '@/domain/playback';
import type { DanceSegments, SegmentNumber } from '@/domain/segment';

export interface DanceProject {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
  durationMs: number;
  sourceVideoBytes: number;
  audioRelativePath: string;
  waveformRelativePath: string;
  preferredRate: PlaybackRate;
  lastSelectedSegment: SegmentNumber | null;
  segments: DanceSegments;
}

export interface ProjectIndexFile {
  schemaVersion: 1;
  projects: DanceProject[];
}

export interface WaveformFile {
  schemaVersion: 1;
  pointCount: 2048;
  durationMs: number;
  amplitudes: number[];
}

import type { PlaybackRange, PlaybackSnapshot, PlaybackStatus } from '@/domain/playback';
import type { DanceProject } from '@/domain/project';
import {
  type ConfiguredDanceSegment,
  type DanceSegment,
  type SegmentIndex,
  isSegmentConfigured,
} from '@/domain/segment';

export type PracticePlaybackIntent = 'pause' | 'play-range';

export function isPracticeSegmentConfigured(
  segment: DanceSegment,
  durationMs: number,
): segment is ConfiguredDanceSegment {
  return isSegmentConfigured(segment, durationMs);
}

export function getConfiguredPracticeSegment(
  project: DanceProject,
  segmentIndex: SegmentIndex | null,
): ConfiguredDanceSegment | null {
  if (segmentIndex === null) {
    return null;
  }

  const segment = project.segments.find((candidate) => candidate.index === segmentIndex);

  return segment !== undefined && isPracticeSegmentConfigured(segment, project.durationMs)
    ? segment
    : null;
}

/**
 * Practice entry always chooses the first valid configured segment in display
 * order. Segment selection is session state and is not persisted in a Project.
 */
export function selectInitialPracticeSegment(project: DanceProject): SegmentIndex | null {
  return (
    project.segments.find((segment) => isPracticeSegmentConfigured(segment, project.durationMs))
      ?.index ?? null
  );
}

export function isPracticeAudioReady(status: PlaybackStatus): boolean {
  return (
    status === 'ready' ||
    status === 'countdown' ||
    status === 'playing' ||
    status === 'paused' ||
    status === 'ended'
  );
}

export function getPracticePlaybackIntent(
  snapshot: PlaybackSnapshot,
  _selectedRange: PlaybackRange,
): PracticePlaybackIntent | null {
  if (snapshot.status === 'playing' || snapshot.status === 'countdown') {
    return 'pause';
  }

  if (snapshot.status === 'ready' || snapshot.status === 'paused' || snapshot.status === 'ended') {
    return 'play-range';
  }

  return null;
}

export function canTogglePracticePlayback(
  snapshot: PlaybackSnapshot,
  selectedRange: PlaybackRange | null,
  hasPendingCommand: boolean,
): boolean {
  return (
    selectedRange !== null &&
    !hasPendingCommand &&
    snapshot.mode === 'practice' &&
    isPracticeAudioReady(snapshot.status) &&
    getPracticePlaybackIntent(snapshot, selectedRange) !== null
  );
}

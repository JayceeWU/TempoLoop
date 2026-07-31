import type { NativePlaybackState, PlaybackSnapshot } from '../../modules/dance-audio';
import type { PlaybackRange } from '@/domain/playback';
import type { DanceProject } from '@/domain/project';
import {
  type ConfiguredDanceSegment,
  type DanceSegment,
  type SegmentNumber,
  getSegmentValidationIssue,
  isSegmentConfigured,
} from '@/domain/segment';

export type PracticePlaybackIntent = 'pause' | 'resume' | 'play-range';

export function isPracticeSegmentConfigured(
  segment: DanceSegment,
  durationMs: number,
): segment is ConfiguredDanceSegment {
  return isSegmentConfigured(segment) && getSegmentValidationIssue(segment, durationMs) === null;
}

export function getConfiguredPracticeSegment(
  project: DanceProject,
  segmentNumber: SegmentNumber | null,
): ConfiguredDanceSegment | null {
  if (segmentNumber === null) {
    return null;
  }

  const segment = project.segments.find((candidate) => candidate.number === segmentNumber);

  return segment !== undefined && isPracticeSegmentConfigured(segment, project.durationMs)
    ? segment
    : null;
}

/**
 * Uses the saved segment only when it is still complete and valid, otherwise
 * chooses the first valid configured segment in display order.
 */
export function selectInitialPracticeSegment(project: DanceProject): SegmentNumber | null {
  const saved = getConfiguredPracticeSegment(project, project.lastSelectedSegment);
  if (saved !== null) {
    return saved.number;
  }

  return (
    project.segments.find((segment) => isPracticeSegmentConfigured(segment, project.durationMs))
      ?.number ?? null
  );
}

export function isPracticeAudioReady(state: NativePlaybackState): boolean {
  return state === 'ready' || state === 'playing' || state === 'paused';
}

export function getPracticePlaybackIntent(
  snapshot: PlaybackSnapshot,
  selectedRange: PlaybackRange,
): PracticePlaybackIntent | null {
  if (snapshot.state === 'playing') {
    return 'pause';
  }

  if (
    snapshot.state === 'paused' &&
    snapshot.activeRangeStartMs === selectedRange.playFromMs &&
    snapshot.activeRangeEndMs === selectedRange.stopAtMs
  ) {
    return 'resume';
  }

  if (snapshot.state === 'ready' || snapshot.state === 'paused') {
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
    isPracticeAudioReady(snapshot.state) &&
    getPracticePlaybackIntent(snapshot, selectedRange) !== null
  );
}

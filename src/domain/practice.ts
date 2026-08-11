import type { PlaybackRange, PlaybackSnapshot, PlaybackStatus } from '@/domain/playback';
import type { DanceProject } from '@/domain/project';
import {
  type ConfiguredPracticeRange,
  type PracticeRangeIndex,
  derivePracticeRanges,
  isPracticeRangeConfigured,
} from '@/domain/segment';

export type PracticePlaybackIntent = 'pause' | 'play-range';

export function getConfiguredPracticeRange(
  project: DanceProject,
  rangeIndex: PracticeRangeIndex | null,
): ConfiguredPracticeRange | null {
  if (rangeIndex === null) {
    return null;
  }

  const range = derivePracticeRanges(project.practiceMarkers, project.durationMs)[rangeIndex];

  return range !== undefined && isPracticeRangeConfigured(range) ? range : null;
}

/**
 * Practice entry always chooses the first available derived range in display
 * order. Range selection is session state and is not persisted in a Project.
 */
export function selectInitialPracticeRange(project: DanceProject): PracticeRangeIndex | null {
  const range = derivePracticeRanges(project.practiceMarkers, project.durationMs).find(
    isPracticeRangeConfigured,
  );
  return range?.index ?? null;
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

import type { PlaybackSnapshot } from '@/domain/playback';
import type { DanceProject } from '@/domain/project';
import {
  canTogglePracticePlayback,
  getPracticePlaybackIntent,
  selectInitialPracticeSegment,
} from '@/domain/practice';
import { createEmptySegments } from '@/domain/segment';

function createProject(overrides: Partial<DanceProject> = {}): DanceProject {
  return {
    schemaVersion: 1,
    id: 'project-1',
    name: 'Practice',
    createdAtIso: '2026-07-30T12:00:00.000Z',
    updatedAtIso: '2026-07-30T12:00:00.000Z',
    audioFileName: 'audio.m4a',
    waveformFileName: 'waveform.json',
    durationMs: 90_000,
    sourceDisplayName: null,
    sourceSizeBytes: null,
    selectedRate: 1,
    segments: createEmptySegments(),
    ...overrides,
  };
}

const READY_SNAPSHOT: PlaybackSnapshot = {
  mode: 'practice',
  status: 'ready',
  projectId: 'project-1',
  segmentIndex: 0,
  sourcePositionMs: 4_000,
  sourceDurationMs: 90_000,
  clipStartMs: 0,
  clipEndMs: null,
  rate: 1,
  commandGeneration: 1,
};

describe('practice selection', () => {
  it('always selects the first valid configured segment in display order', () => {
    const segments = createEmptySegments();
    segments[0] = { ...segments[0], startMs: 1_000, endMs: 2_000 };
    segments[2] = { ...segments[2], startMs: 12_000, endMs: 20_000 };

    expect(selectInitialPracticeSegment(createProject({ segments }))).toBe(0);
  });

  it('skips incomplete rows and selects the first fully valid segment', () => {
    const segments = createEmptySegments();
    segments[0] = { ...segments[0], startMs: 1_000, endMs: null };
    segments[1] = { ...segments[1], startMs: 12_000, endMs: 20_000 };
    segments[2] = { ...segments[2], startMs: 22_000, endMs: 30_000 };

    expect(selectInitialPracticeSegment(createProject({ segments }))).toBe(1);
  });

  it('returns none when no segment is fully valid', () => {
    const segments = createEmptySegments();
    segments[0] = { ...segments[0], startMs: 1_000, endMs: null };
    segments[1] = { ...segments[1], startMs: null, endMs: 2_000 };
    segments[2] = { ...segments[2], startMs: 3_000, endMs: 3_000 };

    expect(selectInitialPracticeSegment(createProject({ segments }))).toBeNull();
  });
});

describe('practice playback intent', () => {
  const selectedRange = {
    playFromMs: 4_000,
    stopAtMs: 20_000,
  };

  it('plays a new range from ready and pauses while playing', () => {
    expect(getPracticePlaybackIntent(READY_SNAPSHOT, selectedRange)).toBe('play-range');
    expect(getPracticePlaybackIntent({ ...READY_SNAPSHOT, status: 'playing' }, selectedRange)).toBe(
      'pause',
    );
  });

  it('resumes only when the paused native range exactly matches the selected range', () => {
    expect(
      getPracticePlaybackIntent(
        {
          ...READY_SNAPSHOT,
          status: 'paused',
          clipStartMs: 4_000,
          clipEndMs: 20_000,
        },
        selectedRange,
      ),
    ).toBe('resume');

    expect(
      getPracticePlaybackIntent(
        {
          ...READY_SNAPSHOT,
          status: 'paused',
          clipStartMs: 3_000,
          clipEndMs: 20_000,
        },
        selectedRange,
      ),
    ).toBe('play-range');
  });

  it('enables playback only for a ready native state, valid range, and no pending command', () => {
    expect(canTogglePracticePlayback(READY_SNAPSHOT, selectedRange, false)).toBe(true);
    expect(canTogglePracticePlayback(READY_SNAPSHOT, null, false)).toBe(false);
    expect(
      canTogglePracticePlayback({ ...READY_SNAPSHOT, status: 'loading' }, selectedRange, false),
    ).toBe(false);
    expect(canTogglePracticePlayback(READY_SNAPSHOT, selectedRange, true)).toBe(false);
  });
});

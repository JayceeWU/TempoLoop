import type { PlaybackSnapshot } from '@/domain/playback';
import type { DanceProject } from '@/domain/project';
import {
  canTogglePracticePlayback,
  getConfiguredPracticeRange,
  getPracticePlaybackIntent,
  selectInitialPracticeRange,
} from '@/domain/practice';
import { createDefaultPracticeMarkers, createEmptyPracticeMarkers } from '@/domain/segment';

function createProject(overrides: Partial<DanceProject> = {}): DanceProject {
  return {
    schemaVersion: 2,
    id: 'project-1',
    name: 'Practice',
    createdAtIso: '2026-07-30T12:00:00.000Z',
    updatedAtIso: '2026-07-30T12:00:00.000Z',
    audioFileName: 'audio.m4a',
    waveformFileName: 'waveform.json',
    waveformStatus: overrides.waveformStatus ?? 'ready',
    durationMs: 90_000,
    sourceDisplayName: null,
    sourceSizeBytes: null,
    selectedRate: 1,
    practiceMarkers: createDefaultPracticeMarkers(90_000),
    ...overrides,
    leadInMs: overrides.leadInMs ?? 6_000,
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
  countdownRemainingSeconds: null,
  commandGeneration: 1,
};

describe('practice selection', () => {
  it('selects the first derived range in display order', () => {
    const practiceMarkers = {
      startMs: [1_000, 12_000, null, null, null, null] as const,
      finalEndMs: 20_000,
    };

    expect(selectInitialPracticeRange(createProject({ practiceMarkers }))).toBe(0);
  });

  it('returns the exact derived range for a configured selection', () => {
    const project = createProject({
      practiceMarkers: {
        startMs: [1_000, 12_000, null, null, null, null],
        finalEndMs: 20_000,
      },
    });

    expect(getConfiguredPracticeRange(project, 2)).toMatchObject({
      label: '1-2',
      startMs: 1_000,
      endMs: 20_000,
    });
  });

  it('returns none when the continuous marker configuration is invalid', () => {
    const practiceMarkers = createEmptyPracticeMarkers();

    expect(selectInitialPracticeRange(createProject({ practiceMarkers }))).toBeNull();
    expect(getConfiguredPracticeRange(createProject({ practiceMarkers }), 0)).toBeNull();
  });
});

describe('practice playback intent', () => {
  const selectedRange = {
    playFromMs: 4_000,
    stopAtMs: 20_000,
    countdownMs: 0,
  };

  it('plays a new range from ready and pauses while playing', () => {
    expect(getPracticePlaybackIntent(READY_SNAPSHOT, selectedRange)).toBe('play-range');
    expect(getPracticePlaybackIntent({ ...READY_SNAPSHOT, status: 'playing' }, selectedRange)).toBe(
      'pause',
    );
    expect(
      getPracticePlaybackIntent({ ...READY_SNAPSHOT, status: 'countdown' }, selectedRange),
    ).toBe('pause');
  });

  it('restarts a paused range instead of resuming its current position', () => {
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
    ).toBe('play-range');

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

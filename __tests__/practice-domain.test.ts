import type { PlaybackSnapshot } from '../modules/dance-audio';
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
    durationMs: 90_000,
    sourceVideoBytes: 1_024,
    audioRelativePath: 'Projects/project-1/audio.m4a',
    waveformRelativePath: 'Projects/project-1/waveform.json',
    preferredRate: 1,
    lastSelectedSegment: null,
    segments: createEmptySegments(),
    ...overrides,
  };
}

const READY_SNAPSHOT: PlaybackSnapshot = {
  state: 'ready',
  currentTimeMs: 4_000,
  durationMs: 90_000,
  rate: 1,
  activeRangeStartMs: null,
  activeRangeEndMs: null,
};

describe('practice selection', () => {
  it('uses the saved segment when it remains configured and valid', () => {
    const project = createProject({
      lastSelectedSegment: 3,
      segments: [
        { number: 1, startMs: 1_000, endMs: 2_000 },
        { number: 2, startMs: null, endMs: null },
        { number: 3, startMs: 12_000, endMs: 20_000 },
        { number: 4, startMs: null, endMs: null },
        { number: 5, startMs: null, endMs: null },
        { number: 6, startMs: null, endMs: null },
      ],
    });

    expect(selectInitialPracticeSegment(project)).toBe(3);
  });

  it('falls back to the first valid configured segment', () => {
    const project = createProject({
      lastSelectedSegment: 4,
      segments: [
        { number: 1, startMs: 1_000, endMs: null },
        { number: 2, startMs: 12_000, endMs: 20_000 },
        { number: 3, startMs: 22_000, endMs: 30_000 },
        { number: 4, startMs: null, endMs: null },
        { number: 5, startMs: null, endMs: null },
        { number: 6, startMs: null, endMs: null },
      ],
    });

    expect(selectInitialPracticeSegment(project)).toBe(2);
  });

  it('returns none when no segment is fully valid', () => {
    const project = createProject({
      lastSelectedSegment: 1,
      segments: [
        { number: 1, startMs: 1_000, endMs: null },
        { number: 2, startMs: null, endMs: 2_000 },
        { number: 3, startMs: 3_000, endMs: 3_000 },
        { number: 4, startMs: null, endMs: null },
        { number: 5, startMs: null, endMs: null },
        { number: 6, startMs: null, endMs: null },
      ],
    });

    expect(selectInitialPracticeSegment(project)).toBeNull();
  });
});

describe('practice playback intent', () => {
  const selectedRange = {
    playFromMs: 4_000,
    stopAtMs: 20_000,
  };

  it('plays a new range from ready and pauses while playing', () => {
    expect(getPracticePlaybackIntent(READY_SNAPSHOT, selectedRange)).toBe('play-range');
    expect(getPracticePlaybackIntent({ ...READY_SNAPSHOT, state: 'playing' }, selectedRange)).toBe(
      'pause',
    );
  });

  it('resumes only when the paused native range exactly matches the selected range', () => {
    expect(
      getPracticePlaybackIntent(
        {
          ...READY_SNAPSHOT,
          state: 'paused',
          activeRangeStartMs: 4_000,
          activeRangeEndMs: 20_000,
        },
        selectedRange,
      ),
    ).toBe('resume');

    expect(
      getPracticePlaybackIntent(
        {
          ...READY_SNAPSHOT,
          state: 'paused',
          activeRangeStartMs: 3_000,
          activeRangeEndMs: 20_000,
        },
        selectedRange,
      ),
    ).toBe('play-range');
  });

  it('enables playback only for a ready native state, valid range, and no pending command', () => {
    expect(canTogglePracticePlayback(READY_SNAPSHOT, selectedRange, false)).toBe(true);
    expect(canTogglePracticePlayback(READY_SNAPSHOT, null, false)).toBe(false);
    expect(
      canTogglePracticePlayback({ ...READY_SNAPSHOT, state: 'loading' }, selectedRange, false),
    ).toBe(false);
    expect(canTogglePracticePlayback(READY_SNAPSHOT, selectedRange, true)).toBe(false);
  });
});

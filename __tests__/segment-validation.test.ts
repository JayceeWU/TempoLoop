import { WAVEFORM_POINT_COUNT } from '@/constants/app';
import {
  createDefaultPracticeMarkers,
  createEmptySegments,
  derivePracticeRanges,
  getPracticeMarkersValidationIssue,
  isPracticeMarkersValid,
  type PracticeMarkers,
} from '@/domain/segment';
import {
  DanceProjectSchema,
  LeadInMsSchema,
  LegacyDanceProjectSchema,
  PlaybackRateSchema,
  PracticeMarkersSchema,
  StoredDanceProjectSchema,
  StoredWaveformSchema,
  migrateLegacyDanceProject,
} from '@/domain/validation';

const PROJECT_ID = '5ec359a0-2692-4d51-85c4-78d30d695931';

function markers(startMs: PracticeMarkers['startMs'], finalEndMs: number | null): PracticeMarkers {
  return { startMs, finalEndMs };
}

function projectFixture() {
  return {
    schemaVersion: 2 as const,
    id: PROJECT_ID,
    name: 'Practice',
    createdAtIso: '2026-07-30T12:00:00.000Z',
    updatedAtIso: '2026-07-30T12:00:00.000Z',
    audioFileName: 'audio.m4a' as const,
    waveformFileName: 'waveform.json' as const,
    waveformStatus: 'ready' as const,
    durationMs: 10_000,
    sourceDisplayName: 'dance.mp4',
    sourceSizeBytes: 1_000,
    selectedRate: 0.8 as const,
    leadInMs: 6_000 as const,
    practiceMarkers: createDefaultPracticeMarkers(10_000),
  };
}

describe('continuous practice marker validation', () => {
  it('creates a whole-track default with independently allocated marker tuples', () => {
    const first = createDefaultPracticeMarkers(10_000);
    const second = createDefaultPracticeMarkers(10_000);

    expect(first).toEqual({
      startMs: [0, null, null, null, null, null],
      finalEndMs: 10_000,
    });
    expect(first.startMs).not.toBe(second.startMs);
    expect(isPracticeMarkersValid(first, 10_000)).toBe(true);
  });

  it.each([
    ['one part', markers([0, null, null, null, null, null], 10_000)],
    ['two parts', markers([0, 4_000, null, null, null, null], 10_000)],
    ['six parts', markers([0, 1_000, 2_000, 3_000, 4_000, 5_000], 10_000)],
  ])('accepts a valid continuous %s configuration', (_label, value) => {
    expect(getPracticeMarkersValidationIssue(value, 10_000)).toBeNull();
    expect(PracticeMarkersSchema.safeParse(value).success).toBe(true);
    expect(
      DanceProjectSchema.safeParse({ ...projectFixture(), practiceMarkers: value }).success,
    ).toBe(true);
  });

  it.each([
    [
      'missing Start 1',
      markers([null, null, null, null, null, null], 10_000),
      { code: 'START_1_REQUIRED', markerId: 'start-1' },
    ],
    [
      'a gap',
      markers([0, null, 2_000, null, null, null], 10_000),
      { code: 'START_GAP', markerId: 'start-2' },
    ],
    [
      'missing Final End',
      markers([0, null, null, null, null, null], null),
      { code: 'FINAL_END_REQUIRED', markerId: 'final-end' },
    ],
    [
      'a fractional start',
      markers([0, 1_000.5, null, null, null, null], 10_000),
      { code: 'NON_INTEGER', markerId: 'start-2' },
    ],
    [
      'an out-of-bounds start',
      markers([-1, null, null, null, null, null], 10_000),
      { code: 'OUT_OF_BOUNDS', markerId: 'start-1' },
    ],
    [
      'non-increasing starts',
      markers([0, 0, null, null, null, null], 10_000),
      { code: 'NOT_STRICTLY_INCREASING', markerId: 'start-2' },
    ],
    [
      'an end before the last start',
      markers([0, 5_000, null, null, null, null], 5_000),
      { code: 'NOT_STRICTLY_INCREASING', markerId: 'final-end' },
    ],
    [
      'an end beyond duration',
      markers([0, null, null, null, null, null], 10_001),
      { code: 'OUT_OF_BOUNDS', markerId: 'final-end' },
    ],
  ])('rejects %s', (_label, value, expectedIssue) => {
    expect(getPracticeMarkersValidationIssue(value, 10_000)).toEqual(expectedIssue);
    expect(isPracticeMarkersValid(value, 10_000)).toBe(false);
    expect(
      DanceProjectSchema.safeParse({ ...projectFixture(), practiceMarkers: value }).success,
    ).toBe(false);
  });

  it('derives the fixed twelve ranges and enables only ranges covered by the prefix', () => {
    const twoParts = derivePracticeRanges(
      markers([0, 4_000, null, null, null, null], 10_000),
      10_000,
    );
    expect(twoParts.map(({ label }) => label)).toEqual([
      '1',
      '2',
      '1-2',
      '3',
      '4',
      '3-4',
      '5',
      '6',
      '5-6',
      '1-4',
      '3-6',
      '1-6',
    ]);
    expect(twoParts.slice(0, 3).map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 4_000],
      [4_000, 10_000],
      [0, 10_000],
    ]);
    expect(
      twoParts.slice(3).every(({ startMs, endMs }) => startMs === null && endMs === null),
    ).toBe(true);
  });

  it.each([
    [1, [0, null, null, null, null, null] as const, 1],
    [2, [0, 1_000, null, null, null, null] as const, 3],
    [3, [0, 1_000, 2_000, null, null, null] as const, 4],
    [4, [0, 1_000, 2_000, 3_000, null, null] as const, 7],
    [5, [0, 1_000, 2_000, 3_000, 4_000, null] as const, 8],
    [6, [0, 1_000, 2_000, 3_000, 4_000, 5_000] as const, 12],
  ])(
    'enables the expected range matrix for a %i-part continuous prefix',
    (partCount, startMs, expectedAvailableCount) => {
      const ranges = derivePracticeRanges(markers(startMs, partCount * 1_000), 10_000);
      expect(ranges.filter((range) => range.startMs !== null && range.endMs !== null)).toHaveLength(
        expectedAvailableCount,
      );
    },
  );

  it('derives all twelve six-part boundaries from adjacent starts and Final End', () => {
    const ranges = derivePracticeRanges(
      markers([0, 1_000, 2_000, 3_000, 4_000, 5_000], 6_000),
      10_000,
    );

    expect(ranges.map(({ label, startMs, endMs }) => [label, startMs, endMs])).toEqual([
      ['1', 0, 1_000],
      ['2', 1_000, 2_000],
      ['1-2', 0, 2_000],
      ['3', 2_000, 3_000],
      ['4', 3_000, 4_000],
      ['3-4', 2_000, 4_000],
      ['5', 4_000, 5_000],
      ['6', 5_000, 6_000],
      ['5-6', 4_000, 6_000],
      ['1-4', 0, 4_000],
      ['3-6', 2_000, 6_000],
      ['1-6', 0, 6_000],
    ]);
  });

  it('uses Start 5 for the 1-4 boundary when a fifth part exists', () => {
    const ranges = derivePracticeRanges(
      markers([0, 1_000, 2_000, 3_000, 4_000, null], 7_000),
      10_000,
    );

    expect(ranges[9]).toMatchObject({ label: '1-4', startMs: 0, endMs: 4_000 });
    expect(ranges[6]).toMatchObject({ label: '5', startMs: 4_000, endMs: 7_000 });
    expect(ranges[10]).toMatchObject({ label: '3-6', startMs: null, endMs: null });
  });

  it('validates schema v2 strictly and migrates validated schema-v1 metadata to whole track', () => {
    const current = projectFixture();
    expect(DanceProjectSchema.parse(current)).toEqual(current);
    expect(DanceProjectSchema.safeParse({ ...current, selectedRate: 0.75 }).success).toBe(false);
    expect(
      DanceProjectSchema.safeParse({ ...current, segments: createEmptySegments() }).success,
    ).toBe(false);

    const { practiceMarkers: _practiceMarkers, ...shared } = current;
    const legacySegments = createEmptySegments();
    legacySegments[0] = { ...legacySegments[0], startMs: 1_000, endMs: 4_000 };
    const legacy = {
      ...shared,
      schemaVersion: 1 as const,
      segments: legacySegments,
    };
    expect(LegacyDanceProjectSchema.safeParse(legacy).success).toBe(true);
    expect(StoredDanceProjectSchema.safeParse(legacy).success).toBe(true);
    expect(
      LegacyDanceProjectSchema.safeParse({
        ...legacy,
        segments: createEmptySegments().slice(0, 6),
      }).success,
    ).toBe(true);
    expect(migrateLegacyDanceProject(LegacyDanceProjectSchema.parse(legacy))).toEqual({
      ...shared,
      schemaVersion: 2,
      practiceMarkers: createDefaultPracticeMarkers(10_000),
    });
  });

  it('accepts only the five playback rates and five project lead-in values', () => {
    expect(
      [1, 0.9, 0.8, 0.7, 0.6].every((value) => PlaybackRateSchema.safeParse(value).success),
    ).toBe(true);
    expect(PlaybackRateSchema.safeParse(0.75).success).toBe(false);
    expect(
      [0, 2_000, 4_000, 6_000, 8_000].every((value) => LeadInMsSchema.safeParse(value).success),
    ).toBe(true);
    expect(
      [undefined, -1, 1_000, 2_000.5, 2_500, 8_001].every(
        (value) => !LeadInMsSchema.safeParse(value).success,
      ),
    ).toBe(true);
  });

  it('requires exactly 2,048 finite normalized waveform samples', () => {
    const samples = Array.from({ length: WAVEFORM_POINT_COUNT }, () => 0.5);
    const waveform = {
      schemaVersion: 1,
      durationMs: 10_000,
      sampleCount: WAVEFORM_POINT_COUNT,
      samples,
    };

    expect(StoredWaveformSchema.safeParse(waveform).success).toBe(true);
    expect(StoredWaveformSchema.safeParse({ ...waveform, samples: samples.slice(1) }).success).toBe(
      false,
    );
    expect(
      StoredWaveformSchema.safeParse({ ...waveform, samples: [Number.NaN, ...samples.slice(1)] })
        .success,
    ).toBe(false);
  });
});

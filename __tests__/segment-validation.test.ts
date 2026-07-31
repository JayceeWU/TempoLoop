import {
  areSegmentsValid,
  createEmptySegments,
  isSegmentConfigured,
  isSegmentValid,
  type DanceSegments,
} from '@/domain/segment';
import {
  DanceProjectSchema,
  DanceSegmentsSchema,
  ProjectIndexFileSchema,
} from '@/domain/validation';

describe('segment validation', () => {
  it('creates exactly six independently allocated unset segments', () => {
    const first = createEmptySegments();
    const second = createEmptySegments();

    expect(first).toEqual([
      { number: 1, startMs: null, endMs: null },
      { number: 2, startMs: null, endMs: null },
      { number: 3, startMs: null, endMs: null },
      { number: 4, startMs: null, endMs: null },
      { number: 5, startMs: null, endMs: null },
      { number: 6, startMs: null, endMs: null },
    ]);
    expect(first).toHaveLength(6);
    expect(first[0]).not.toBe(second[0]);
  });

  it.each([
    ['fully unset', null, null, true],
    ['start only', 1_000, null, false],
    ['end only', null, 2_000, false],
    ['equal endpoints', 1_000, 1_000, false],
    ['start after end', 2_000, 1_000, false],
    ['end beyond duration', 1_000, 10_001, false],
    ['valid configured segment', 1_000, 2_000, true],
  ])('%s has the expected validity', (_label, startMs, endMs, expected) => {
    const segment = { number: 1 as const, startMs, endMs };

    expect(isSegmentValid(segment, 10_000)).toBe(expected);
    expect(isSegmentConfigured(segment)).toBe(startMs !== null && endMs !== null);
  });

  it('accepts overlapping ranges because segments are independent', () => {
    const segments: DanceSegments = [
      { number: 1, startMs: 1_000, endMs: 5_000 },
      { number: 2, startMs: 3_000, endMs: 7_000 },
      { number: 3, startMs: null, endMs: null },
      { number: 4, startMs: null, endMs: null },
      { number: 5, startMs: null, endMs: null },
      { number: 6, startMs: null, endMs: null },
    ];

    expect(areSegmentsValid(segments, 10_000)).toBe(true);
    expect(DanceSegmentsSchema.safeParse(segments).success).toBe(true);
  });

  it('requires the strict six-item segment order at runtime', () => {
    const segments = createEmptySegments();
    const wrongOrder = [...segments];
    [wrongOrder[0], wrongOrder[1]] = [wrongOrder[1], wrongOrder[0]];

    expect(DanceSegmentsSchema.safeParse(segments).success).toBe(true);
    expect(DanceSegmentsSchema.safeParse(segments.slice(0, 5)).success).toBe(false);
    expect(DanceSegmentsSchema.safeParse(wrongOrder).success).toBe(false);
  });

  it('validates segment endpoints against project duration', () => {
    const project = {
      schemaVersion: 1,
      id: '5ec359a0-2692-4d51-85c4-78d30d695931',
      name: 'Practice',
      createdAtIso: '2026-07-30T12:00:00.000Z',
      updatedAtIso: '2026-07-30T12:00:00.000Z',
      durationMs: 10_000,
      sourceVideoBytes: 1_000,
      audioRelativePath: 'Projects/id/audio.m4a',
      waveformRelativePath: 'Projects/id/waveform.json',
      preferredRate: 1,
      lastSelectedSegment: 1,
      segments: [
        { number: 1, startMs: 9_000, endMs: 10_001 },
        { number: 2, startMs: null, endMs: null },
        { number: 3, startMs: null, endMs: null },
        { number: 4, startMs: null, endMs: null },
        { number: 5, startMs: null, endMs: null },
        { number: 6, startMs: null, endMs: null },
      ],
    };

    expect(DanceProjectSchema.safeParse(project).success).toBe(false);
  });

  it('rejects duplicate project identities and storage paths', () => {
    const project = {
      schemaVersion: 1 as const,
      id: '5ec359a0-2692-4d51-85c4-78d30d695931',
      name: 'Practice',
      createdAtIso: '2026-07-30T12:00:00.000Z',
      updatedAtIso: '2026-07-30T12:00:00.000Z',
      durationMs: 10_000,
      sourceVideoBytes: 1_000,
      audioRelativePath: 'Projects/5ec359a0-2692-4d51-85c4-78d30d695931/audio.m4a',
      waveformRelativePath: 'Projects/5ec359a0-2692-4d51-85c4-78d30d695931/waveform.json',
      preferredRate: 1 as const,
      lastSelectedSegment: null,
      segments: createEmptySegments(),
    };

    expect(
      ProjectIndexFileSchema.safeParse({
        schemaVersion: 1,
        projects: [project],
      }).success,
    ).toBe(true);
    expect(
      ProjectIndexFileSchema.safeParse({
        schemaVersion: 1,
        projects: [project, { ...project, name: 'Duplicate' }],
      }).success,
    ).toBe(false);
  });

  it('binds each project metadata record to its own sandbox media paths', () => {
    const id = '5ec359a0-2692-4d51-85c4-78d30d695931';
    const project = {
      schemaVersion: 1 as const,
      id,
      name: 'Practice',
      createdAtIso: '2026-07-30T12:00:00.000Z',
      updatedAtIso: '2026-07-30T12:00:00.000Z',
      durationMs: 10_000,
      sourceVideoBytes: 1_000,
      audioRelativePath: `Projects/${id}/audio.m4a`,
      waveformRelativePath: `Projects/${id}/waveform.json`,
      preferredRate: 1 as const,
      lastSelectedSegment: null,
      segments: createEmptySegments(),
    };

    expect(DanceProjectSchema.safeParse(project).success).toBe(true);
    expect(
      DanceProjectSchema.safeParse({
        ...project,
        audioRelativePath: 'Projects/another-project/audio.m4a',
      }).success,
    ).toBe(false);
    expect(
      DanceProjectSchema.safeParse({
        ...project,
        waveformRelativePath: 'Projects/another-project/waveform.json',
      }).success,
    ).toBe(false);
  });
});

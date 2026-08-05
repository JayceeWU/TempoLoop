import { WAVEFORM_POINT_COUNT } from '@/constants/app';
import {
  areSegmentsValid,
  createEmptySegments,
  isSegmentConfigured,
  isSegmentValid,
} from '@/domain/segment';
import {
  DanceProjectSchema,
  DanceSegmentsSchema,
  LeadInMsSchema,
  PlaybackRateSchema,
  StoredWaveformSchema,
} from '@/domain/validation';

describe('segment validation', () => {
  it('creates exactly nine independently allocated unset segments with fixed IDs and indexes', () => {
    const first = createEmptySegments();
    const second = createEmptySegments();

    expect(first).toEqual([
      { id: 'segment-1', index: 0, startMs: null, endMs: null },
      { id: 'segment-2', index: 1, startMs: null, endMs: null },
      { id: 'segment-3', index: 2, startMs: null, endMs: null },
      { id: 'segment-4', index: 3, startMs: null, endMs: null },
      { id: 'segment-5', index: 4, startMs: null, endMs: null },
      { id: 'segment-6', index: 5, startMs: null, endMs: null },
      { id: 'segment-7', index: 6, startMs: null, endMs: null },
      { id: 'segment-8', index: 7, startMs: null, endMs: null },
      { id: 'segment-9', index: 8, startMs: null, endMs: null },
    ]);
    expect(first).toHaveLength(9);
    expect(first[0]).not.toBe(second[0]);
  });

  it.each([
    ['fully unset', null, null, true, false],
    ['start only', 1_000, null, false, false],
    ['end only', null, 2_000, false, false],
    ['equal endpoints', 1_000, 1_000, false, false],
    ['start after end', 2_000, 1_000, false, false],
    ['negative start', -1, 1_000, false, false],
    ['fractional time', 1_000.5, 2_000, false, false],
    ['end beyond duration', 1_000, 10_001, false, false],
    ['valid configured segment', 1_000, 2_000, true, true],
  ])(
    '%s has the expected validity',
    (_label, startMs, endMs, expectedValid, expectedConfigured) => {
      const segment = { id: 'segment-1' as const, index: 0 as const, startMs, endMs };

      expect(isSegmentValid(segment, 10_000)).toBe(expectedValid);
      expect(isSegmentConfigured(segment, 10_000)).toBe(expectedConfigured);
    },
  );

  it('accepts overlapping ranges because segments are independent', () => {
    const segments = createEmptySegments();
    segments[0] = { ...segments[0], startMs: 1_000, endMs: 5_000 };
    segments[1] = { ...segments[1], startMs: 3_000, endMs: 7_000 };

    expect(areSegmentsValid(segments, 10_000)).toBe(true);
    expect(DanceSegmentsSchema.safeParse(segments).success).toBe(true);
  });

  it('requires nine ordered rows and upgrades legacy six-row projects', () => {
    const segments = createEmptySegments();
    const wrongOrder = [...segments];
    [wrongOrder[0], wrongOrder[1]] = [wrongOrder[1]!, wrongOrder[0]!];
    const mismatchedIdentity = createEmptySegments();
    mismatchedIdentity[0] = { ...mismatchedIdentity[0], id: 'segment-2' };

    expect(DanceSegmentsSchema.safeParse(segments).success).toBe(true);
    expect(DanceSegmentsSchema.safeParse(segments.slice(0, 5)).success).toBe(false);
    expect(DanceSegmentsSchema.parse(segments.slice(0, 6))).toEqual(segments);
    expect(DanceSegmentsSchema.safeParse(segments.slice(0, 7)).success).toBe(false);
    expect(DanceSegmentsSchema.safeParse(wrongOrder).success).toBe(false);
    expect(DanceSegmentsSchema.safeParse(mismatchedIdentity).success).toBe(false);
  });

  it('validates segment endpoints against project duration', () => {
    const segments = createEmptySegments();
    segments[0] = { ...segments[0], startMs: 9_000, endMs: 10_001 };

    expect(
      DanceProjectSchema.safeParse({
        schemaVersion: 1,
        id: '5ec359a0-2692-4d51-85c4-78d30d695931',
        name: 'Practice',
        createdAtIso: '2026-07-30T12:00:00.000Z',
        updatedAtIso: '2026-07-30T12:00:00.000Z',
        audioFileName: 'audio.m4a',
        waveformFileName: 'waveform.json',
        waveformStatus: 'ready',
        durationMs: 10_000,
        sourceDisplayName: null,
        sourceSizeBytes: null,
        selectedRate: 1,
        segments,
      }).success,
    ).toBe(false);
  });

  it('accepts only the Android project metadata shape and exact playback rates', () => {
    const project = {
      schemaVersion: 1 as const,
      id: '5ec359a0-2692-4d51-85c4-78d30d695931',
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
      segments: createEmptySegments(),
    };

    const legacyResult = DanceProjectSchema.safeParse(project);
    expect(legacyResult.success).toBe(true);
    if (legacyResult.success) {
      expect(legacyResult.data.leadInMs).toBe(6_000);
    }
    const { waveformStatus: _waveformStatus, ...projectWithoutWaveformStatus } = project;
    expect(_waveformStatus).toBe('ready');
    const legacyWaveformStatus = DanceProjectSchema.parse(projectWithoutWaveformStatus);
    expect(legacyWaveformStatus.waveformStatus).toBe('ready');
    expect(DanceProjectSchema.safeParse({ ...project, preferredRate: 0.8 }).success).toBe(false);
    expect(DanceProjectSchema.safeParse({ ...project, selectedRate: 0.75 }).success).toBe(false);
    expect(PlaybackRateSchema.safeParse(0.6).success).toBe(true);
    expect(PlaybackRateSchema.safeParse(0.7).success).toBe(true);
    expect(PlaybackRateSchema.safeParse(0.75).success).toBe(false);
  });

  it('accepts only the four project lead-in values', () => {
    expect([0, 2_000, 4_000, 6_000].every((value) => LeadInMsSchema.safeParse(value).success)).toBe(
      true,
    );
    expect(
      [undefined, -1, 1_000, 2_000.5, 2_500, 6_001].every(
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

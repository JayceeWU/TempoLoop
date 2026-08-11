import {
  AUDIO_FILE_NAME,
  DEFAULT_LEAD_IN_MS,
  MAX_PROJECT_NAME_LENGTH,
  PROJECT_SCHEMA_VERSION,
  WAVEFORM_FILE_NAME,
  WAVEFORM_POINT_COUNT,
  WAVEFORM_SCHEMA_VERSION,
} from '@/constants/app';
import { LEAD_IN_OPTIONS_MS, PLAYBACK_RATES } from '@/domain/playback';
import type { DanceProject, LegacyDanceProject, StoredWaveform } from '@/domain/project';
import {
  PRACTICE_MARKER_IDS,
  PRACTICE_START_INDEXES,
  SEGMENT_IDS,
  SEGMENT_INDEXES,
  createDefaultPracticeMarkers,
  getPracticeMarkersValidationIssue,
  getSegmentValidationIssue,
  type DanceSegment,
  type DanceSegments,
  type PracticeMarkerId,
  type PracticeMarkers,
  type PracticeStartIndex,
  type SegmentId,
  type SegmentIndex,
} from '@/domain/segment';
import { z } from 'zod';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const PATH_SEPARATOR_PATTERN = /[\\/]/u;

export function normalizeProjectName(value: string): string {
  return value.trim();
}

function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

export const ProjectNameSchema = z
  .string()
  .transform(normalizeProjectName)
  .pipe(
    z
      .string()
      .refine((value) => countUnicodeCodePoints(value) >= 1, {
        message: 'Project name is required.',
      })
      .refine((value) => countUnicodeCodePoints(value) <= MAX_PROJECT_NAME_LENGTH, {
        message: `Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer.`,
      })
      .refine((value) => !CONTROL_CHARACTER_PATTERN.test(value), {
        message: 'Project name cannot contain control characters.',
      })
      .refine((value) => !PATH_SEPARATOR_PATTERN.test(value), {
        message: 'Project name cannot contain path separators.',
      }),
  );

const NullableMillisecondsSchema = z.number().finite().int().nullable();

export const PracticeStartIndexSchema: z.ZodType<PracticeStartIndex> = z.union(
  PRACTICE_START_INDEXES.map((index) => z.literal(index)),
);

export const PracticeMarkerIdSchema: z.ZodType<PracticeMarkerId> = z.union(
  PRACTICE_MARKER_IDS.map((id) => z.literal(id)),
);

const PracticeStartTimesSchema = z.tuple([
  NullableMillisecondsSchema,
  NullableMillisecondsSchema,
  NullableMillisecondsSchema,
  NullableMillisecondsSchema,
  NullableMillisecondsSchema,
  NullableMillisecondsSchema,
]);

function practiceMarkerPath(markerId: PracticeMarkerId): (string | number)[] {
  if (markerId === 'final-end') {
    return ['finalEndMs'];
  }
  return ['startMs', PRACTICE_MARKER_IDS.indexOf(markerId)];
}

function practiceMarkerIssueMessage(code: string): string {
  switch (code) {
    case 'START_1_REQUIRED':
      return 'Start 1 is required.';
    case 'START_GAP':
      return 'Practice starts must form a continuous prefix.';
    case 'FINAL_END_REQUIRED':
      return 'Final End is required.';
    case 'NON_INTEGER':
      return 'Practice marker times must use integer milliseconds.';
    case 'OUT_OF_BOUNDS':
      return 'Practice marker times must stay inside the audio duration.';
    default:
      return 'Practice marker times must be strictly increasing.';
  }
}

export const PracticeMarkersShapeSchema: z.ZodType<PracticeMarkers> = z.strictObject({
  startMs: PracticeStartTimesSchema,
  finalEndMs: NullableMillisecondsSchema,
});

export const PracticeMarkersSchema: z.ZodType<PracticeMarkers> =
  PracticeMarkersShapeSchema.superRefine((markers, context) => {
    const issue = getPracticeMarkersValidationIssue(markers, Number.MAX_SAFE_INTEGER);
    if (issue !== null) {
      context.addIssue({
        code: 'custom',
        path: practiceMarkerPath(issue.markerId),
        message: practiceMarkerIssueMessage(issue.code),
      });
    }
  });

/* Schema-v1 segment validation is retained exclusively for migration. */
export const SegmentIndexSchema: z.ZodType<SegmentIndex> = z.union(
  SEGMENT_INDEXES.map((index) => z.literal(index)),
);
export const SegmentIdSchema: z.ZodType<SegmentId> = z.union(
  SEGMENT_IDS.map((id) => z.literal(id)),
);

function addSegmentValidationIssue(segment: DanceSegment, context: z.RefinementCtx): void {
  if (segment.id !== SEGMENT_IDS[segment.index]) {
    context.addIssue({
      code: 'custom',
      path: ['id'],
      message: 'Segment ID must match its index.',
    });
  }

  const issue = getSegmentValidationIssue(segment, Number.MAX_SAFE_INTEGER);
  if (issue === null) return;
  if (issue === 'PARTIAL') {
    context.addIssue({
      code: 'custom',
      message: 'Start and end must both be set or both be unset.',
    });
  } else if (issue === 'NON_INTEGER') {
    context.addIssue({ code: 'custom', message: 'Segment times must use integer milliseconds.' });
  } else if (issue === 'OUT_OF_BOUNDS') {
    context.addIssue({ code: 'custom', message: 'Segment times cannot be negative.' });
  } else {
    context.addIssue({ code: 'custom', message: 'Segment start must be before its end.' });
  }
}

const DanceSegmentShape = {
  id: SegmentIdSchema,
  index: SegmentIndexSchema,
  startMs: NullableMillisecondsSchema,
  endMs: NullableMillisecondsSchema,
};

export const DanceSegmentSchema: z.ZodType<DanceSegment> = z
  .strictObject(DanceSegmentShape)
  .superRefine(addSegmentValidationIssue);

function indexedSegmentSchema(index: SegmentIndex) {
  return z
    .strictObject({
      ...DanceSegmentShape,
      id: z.literal(SEGMENT_IDS[index]),
      index: z.literal(index),
    })
    .superRefine(addSegmentValidationIssue);
}

const NineDanceSegmentsSchema = z.tuple([
  indexedSegmentSchema(0),
  indexedSegmentSchema(1),
  indexedSegmentSchema(2),
  indexedSegmentSchema(3),
  indexedSegmentSchema(4),
  indexedSegmentSchema(5),
  indexedSegmentSchema(6),
  indexedSegmentSchema(7),
  indexedSegmentSchema(8),
]);

/** Schema-v1 briefly used six rows; normalize it before the v1-to-v2 migration. */
export const DanceSegmentsSchema: z.ZodType<DanceSegments> = z.preprocess((value) => {
  if (!Array.isArray(value) || value.length !== 6) return value;
  return [
    ...value,
    ...SEGMENT_INDEXES.slice(6).map((index) => ({
      id: SEGMENT_IDS[index],
      index,
      startMs: null,
      endMs: null,
    })),
  ];
}, NineDanceSegmentsSchema);

export const PlaybackRateSchema = z.union(PLAYBACK_RATES.map((rate) => z.literal(rate)));
export const LeadInMsSchema = z.union(LEAD_IN_OPTIONS_MS.map((leadInMs) => z.literal(leadInMs)));
export const WaveformStatusSchema = z.enum(['pending', 'ready', 'failed']);

const IsoDateTimeSchema = z.string().datetime({ offset: true });
const SharedProjectShape = {
  id: z.string().uuid(),
  name: ProjectNameSchema,
  createdAtIso: IsoDateTimeSchema,
  updatedAtIso: IsoDateTimeSchema,
  audioFileName: z.literal(AUDIO_FILE_NAME),
  waveformFileName: z.literal(WAVEFORM_FILE_NAME),
  waveformStatus: WaveformStatusSchema.default('ready'),
  durationMs: z.number().finite().int().positive(),
  sourceDisplayName: z.string().nullable(),
  sourceSizeBytes: z.number().finite().int().nonnegative().nullable(),
  selectedRate: PlaybackRateSchema,
  leadInMs: LeadInMsSchema.default(DEFAULT_LEAD_IN_MS),
};

const DanceProjectBaseSchema = z.strictObject({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  ...SharedProjectShape,
  practiceMarkers: PracticeMarkersSchema,
});

export const DanceProjectSchema: z.ZodType<DanceProject> = DanceProjectBaseSchema.superRefine(
  (project, context) => {
    const issue = getPracticeMarkersValidationIssue(project.practiceMarkers, project.durationMs);
    if (issue !== null) {
      context.addIssue({
        code: 'custom',
        path: ['practiceMarkers', ...practiceMarkerPath(issue.markerId)],
        message: practiceMarkerIssueMessage(issue.code),
      });
    }
  },
);

export const LegacyDanceProjectSchema: z.ZodType<LegacyDanceProject> = z.strictObject({
  schemaVersion: z.literal(1),
  ...SharedProjectShape,
  segments: DanceSegmentsSchema,
});

export const StoredDanceProjectSchema: z.ZodType<DanceProject | LegacyDanceProject> = z.union([
  DanceProjectSchema,
  LegacyDanceProjectSchema,
]);

export function migrateLegacyDanceProject(project: LegacyDanceProject): DanceProject {
  const { segments: _legacySegments, ...shared } = project;
  return DanceProjectSchema.parse({
    ...shared,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    practiceMarkers: createDefaultPracticeMarkers(project.durationMs),
  });
}

export const StoredWaveformSchema: z.ZodType<StoredWaveform> = z.strictObject({
  schemaVersion: z.literal(WAVEFORM_SCHEMA_VERSION),
  durationMs: z.number().finite().int().positive(),
  sampleCount: z.literal(WAVEFORM_POINT_COUNT),
  samples: z.array(z.number().finite().min(0).max(1)).length(WAVEFORM_POINT_COUNT),
});

/** Temporary naming compatibility while callers migrate to StoredWaveformSchema. */
export const WaveformFileSchema = StoredWaveformSchema;

export const projectNameSchema = ProjectNameSchema;
export const danceSegmentSchema = DanceSegmentSchema;
export const danceSegmentsSchema = DanceSegmentsSchema;
export const danceProjectSchema = DanceProjectSchema;
export const waveformFileSchema = StoredWaveformSchema;

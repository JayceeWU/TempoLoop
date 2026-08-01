import {
  AUDIO_FILE_NAME,
  MAX_PROJECT_NAME_LENGTH,
  PROJECT_SCHEMA_VERSION,
  WAVEFORM_FILE_NAME,
  WAVEFORM_POINT_COUNT,
  WAVEFORM_SCHEMA_VERSION,
} from '@/constants/app';
import { PLAYBACK_RATES } from '@/domain/playback';
import type { DanceProject, StoredWaveform } from '@/domain/project';
import {
  SEGMENT_IDS,
  SEGMENT_INDEXES,
  getSegmentValidationIssue,
  type DanceSegment,
  type DanceSegments,
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

export const SegmentIndexSchema: z.ZodType<SegmentIndex> = z.union(
  SEGMENT_INDEXES.map((index) => z.literal(index)),
);
export const SegmentIdSchema: z.ZodType<SegmentId> = z.union(
  SEGMENT_IDS.map((id) => z.literal(id)),
);

const NullableMillisecondsSchema = z.number().finite().int().nullable();

function addSegmentValidationIssue(segment: DanceSegment, context: z.RefinementCtx): void {
  if (segment.id !== SEGMENT_IDS[segment.index]) {
    context.addIssue({
      code: 'custom',
      path: ['id'],
      message: 'Segment ID must match its index.',
    });
  }

  const issue = getSegmentValidationIssue(segment, Number.MAX_SAFE_INTEGER);

  if (issue === null) {
    return;
  }

  if (issue === 'PARTIAL') {
    context.addIssue({
      code: 'custom',
      message: 'Start and end must both be set or both be unset.',
    });
    return;
  }

  if (issue === 'NON_INTEGER') {
    context.addIssue({
      code: 'custom',
      message: 'Segment times must use integer milliseconds.',
    });
    return;
  }

  if (issue === 'OUT_OF_BOUNDS') {
    context.addIssue({
      code: 'custom',
      message: 'Segment times cannot be negative.',
    });
    return;
  }

  context.addIssue({
    code: 'custom',
    message: 'Segment start must be before its end.',
  });
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

export const DanceSegmentsSchema: z.ZodType<DanceSegments> = z.tuple([
  indexedSegmentSchema(0),
  indexedSegmentSchema(1),
  indexedSegmentSchema(2),
  indexedSegmentSchema(3),
  indexedSegmentSchema(4),
  indexedSegmentSchema(5),
]);

export const PlaybackRateSchema = z.union(PLAYBACK_RATES.map((rate) => z.literal(rate)));

const IsoDateTimeSchema = z.string().datetime({ offset: true });

const DanceProjectBaseSchema = z.strictObject({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().uuid(),
  name: ProjectNameSchema,
  createdAtIso: IsoDateTimeSchema,
  updatedAtIso: IsoDateTimeSchema,
  audioFileName: z.literal(AUDIO_FILE_NAME),
  waveformFileName: z.literal(WAVEFORM_FILE_NAME),
  durationMs: z.number().finite().int().positive(),
  sourceDisplayName: z.string().nullable(),
  sourceSizeBytes: z.number().finite().int().nonnegative().nullable(),
  selectedRate: PlaybackRateSchema,
  segments: DanceSegmentsSchema,
});

export const DanceProjectSchema: z.ZodType<DanceProject> = DanceProjectBaseSchema.superRefine(
  (project, context) => {
    project.segments.forEach((segment, index) => {
      if (
        segment.startMs !== null &&
        segment.endMs !== null &&
        segment.endMs > project.durationMs
      ) {
        context.addIssue({
          code: 'custom',
          path: ['segments', index, 'endMs'],
          message: 'Segment end cannot exceed the project duration.',
        });
      }
    });
  },
);

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

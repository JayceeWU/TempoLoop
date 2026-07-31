import {
  AUDIO_FILE_NAME,
  MAX_PROJECT_NAME_LENGTH,
  PROJECTS_DIRECTORY_NAME,
  PROJECT_SCHEMA_VERSION,
  WAVEFORM_FILE_NAME,
  WAVEFORM_POINT_COUNT,
  WAVEFORM_SCHEMA_VERSION,
} from '@/constants/app';
import { PLAYBACK_RATES } from '@/domain/playback';
import type { DanceProject, ProjectIndexFile, WaveformFile } from '@/domain/project';
import {
  SEGMENT_NUMBERS,
  getSegmentValidationIssue,
  type DanceSegment,
  type DanceSegments,
} from '@/domain/segment';
import { z } from 'zod';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]+/g;

export function normalizeProjectName(value: string): string {
  return value.replace(CONTROL_CHARACTER_PATTERN, ' ').trim();
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
      }),
  );

export const SegmentNumberSchema = z.union(SEGMENT_NUMBERS.map((number) => z.literal(number)));

const NullableMillisecondsSchema = z.number().finite().int().nullable();

function addSegmentValidationIssue(segment: DanceSegment, context: z.RefinementCtx): void {
  const durationForIndependentChecks = Number.MAX_SAFE_INTEGER;
  const issue = getSegmentValidationIssue(segment, durationForIndependentChecks);

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
  number: SegmentNumberSchema,
  startMs: NullableMillisecondsSchema,
  endMs: NullableMillisecondsSchema,
};

export const DanceSegmentSchema: z.ZodType<DanceSegment> = z
  .strictObject(DanceSegmentShape)
  .superRefine(addSegmentValidationIssue);

function numberedSegmentSchema(number: (typeof SEGMENT_NUMBERS)[number]) {
  return z
    .strictObject({
      ...DanceSegmentShape,
      number: z.literal(number),
    })
    .superRefine(addSegmentValidationIssue);
}

export const DanceSegmentsSchema: z.ZodType<DanceSegments> = z.tuple([
  numberedSegmentSchema(1),
  numberedSegmentSchema(2),
  numberedSegmentSchema(3),
  numberedSegmentSchema(4),
  numberedSegmentSchema(5),
  numberedSegmentSchema(6),
]);

const PlaybackRateSchema = z.union(PLAYBACK_RATES.map((rate) => z.literal(rate)));

const RelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !/^[a-z][a-z\d+.-]*:/i.test(value) &&
      !value.split(/[\\/]/).includes('..'),
    { message: 'Expected a safe relative path.' },
  );

const IsoDateTimeSchema = z.string().datetime({ offset: true });

const DanceProjectBaseSchema = z.strictObject({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().uuid(),
  name: ProjectNameSchema,
  createdAtIso: IsoDateTimeSchema,
  updatedAtIso: IsoDateTimeSchema,
  durationMs: z.number().finite().int().positive(),
  sourceVideoBytes: z.number().finite().int().positive(),
  audioRelativePath: RelativePathSchema,
  waveformRelativePath: RelativePathSchema,
  preferredRate: PlaybackRateSchema,
  lastSelectedSegment: SegmentNumberSchema.nullable(),
  segments: DanceSegmentsSchema,
});

export const DanceProjectSchema: z.ZodType<DanceProject> = DanceProjectBaseSchema.superRefine(
  (project, context) => {
    const expectedAudioPath = `${PROJECTS_DIRECTORY_NAME}/${project.id}/${AUDIO_FILE_NAME}`;
    const expectedWaveformPath = `${PROJECTS_DIRECTORY_NAME}/${project.id}/${WAVEFORM_FILE_NAME}`;

    if (project.audioRelativePath !== expectedAudioPath) {
      context.addIssue({
        code: 'custom',
        path: ['audioRelativePath'],
        message: 'Project audio path must match its project ID.',
      });
    }

    if (project.waveformRelativePath !== expectedWaveformPath) {
      context.addIssue({
        code: 'custom',
        path: ['waveformRelativePath'],
        message: 'Project waveform path must match its project ID.',
      });
    }

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

export const ProjectIndexFileSchema: z.ZodType<ProjectIndexFile> = z
  .strictObject({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    projects: z.array(DanceProjectSchema),
  })
  .superRefine((index, context) => {
    const projectIds = new Set<string>();
    const audioPaths = new Set<string>();
    const waveformPaths = new Set<string>();

    index.projects.forEach((project, projectIndex) => {
      const uniqueFields = [
        ['id', project.id, projectIds],
        ['audioRelativePath', project.audioRelativePath, audioPaths],
        ['waveformRelativePath', project.waveformRelativePath, waveformPaths],
      ] as const;

      uniqueFields.forEach(([field, value, seen]) => {
        if (seen.has(value)) {
          context.addIssue({
            code: 'custom',
            path: ['projects', projectIndex, field],
            message: `Each project must have a unique ${field}.`,
          });
          return;
        }

        seen.add(value);
      });
    });
  });

export const WaveformFileSchema: z.ZodType<WaveformFile> = z.strictObject({
  schemaVersion: z.literal(WAVEFORM_SCHEMA_VERSION),
  pointCount: z.literal(WAVEFORM_POINT_COUNT),
  durationMs: z.number().finite().int().positive(),
  amplitudes: z.array(z.number().finite().min(0).max(1)).length(WAVEFORM_POINT_COUNT),
});

export const projectNameSchema = ProjectNameSchema;
export const danceSegmentSchema = DanceSegmentSchema;
export const danceSegmentsSchema = DanceSegmentsSchema;
export const danceProjectSchema = DanceProjectSchema;
export const projectIndexFileSchema = ProjectIndexFileSchema;
export const waveformFileSchema = WaveformFileSchema;

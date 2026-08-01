import type * as DocumentPicker from 'expo-document-picker';

import { MAX_AUDIO_BYTES, MAX_VIDEO_BYTES, WAVEFORM_POINT_COUNT } from '@/constants/app';
import { COPY } from '@/constants/copy';
import type { DanceProject } from '@/domain/project';
import { createEmptySegments } from '@/domain/segment';
import type { FinalizeImportInput } from '@/repositories/ProjectRepository';
import {
  IMPORT_KEEP_AWAKE_TAG,
  AUDIO_DOCUMENT_PICKER_MIME_TYPES,
  ImportCoordinator,
  ImportCoordinatorError,
  type DocumentPickerDependency,
  type ImportMediaDependency,
  type ImportProjectRepository,
  type KeepAwakeDependency,
  type SelectedMedia,
  suggestedProjectName,
} from '@/services/ImportCoordinator';
import type { PartialAudioValidator } from '@/services/PartialAudioValidator';
import { DevelopmentLog } from '@/services/DevelopmentLog';
import { StructuredDevelopmentDiagnostics } from '@/services/StructuredDevelopmentDiagnostics';
import { TempoLoopMediaServiceError } from '@/services/TempoLoopMediaService';
import { useImportStore } from '@/stores/useImportStore';
import type {
  ImportMediaOptions,
  ImportMediaResult,
  ImportProgressEvent,
  InspectMediaOptions,
  MediaInspection,
  PickedMediaSource,
  TempoLoopMediaSubscription,
} from '../modules/tempoloop-media';

const SELECTION_ID = '00000000-0000-4000-8000-000000000000';
const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const CONTENT_URI = 'content://com.android.providers.media.documents/document/video%3A42';
const PARTIAL_URI = `file:///documents/TempoLoop/imports/.import-${PROJECT_ID}/audio.m4a.partial`;
const DURATION_MS = 90_000;
const VIDEO_BYTES = 250 * 1024 * 1024;

const INSPECTION: MediaInspection = {
  sourceKind: 'video',
  sourceSizeBytes: VIDEO_BYTES,
  durationMs: DURATION_MS,
  audioMimeType: 'audio/mp4a-latm',
  sampleRate: 48_000,
  channelCount: 2,
};

function mediaResult(overrides: Partial<ImportMediaResult> = {}): ImportMediaResult {
  return {
    audioUri: PARTIAL_URI,
    audioSizeBytes: 2_000_000,
    durationMs: DURATION_MS,
    waveform: Array.from({ length: WAVEFORM_POINT_COUNT }, (_, index) => index / 2_048),
    ...overrides,
  };
}

function project(input: FinalizeImportInput): DanceProject {
  return {
    schemaVersion: 1,
    id: input.projectId,
    name: input.name,
    createdAtIso: '2026-07-31T12:00:00.000Z',
    updatedAtIso: '2026-07-31T12:00:00.000Z',
    audioFileName: 'audio.m4a',
    waveformFileName: 'waveform.json',
    durationMs: input.result.durationMs,
    sourceDisplayName: input.sourceDisplayName,
    sourceSizeBytes: input.inspection.sourceSizeBytes,
    selectedRate: 1,
    segments: createEmptySegments(),
  };
}

function pickerResult(
  overrides: Partial<DocumentPicker.DocumentPickerAsset> = {},
): DocumentPicker.DocumentPickerResult {
  return {
    canceled: false,
    assets: [
      {
        uri: CONTENT_URI,
        name: 'practice.mov',
        size: VIDEO_BYTES,
        mimeType: 'video/quicktime',
        ...overrides,
        lastModified: overrides.lastModified ?? 0,
      },
    ],
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface HarnessOptions {
  readonly pickerResult?: DocumentPicker.DocumentPickerResult;
  readonly galleryResult?: PickedMediaSource | null;
  readonly inspection?: MediaInspection;
  readonly result?: ImportMediaResult | Promise<ImportMediaResult>;
  readonly refresh?: () => Promise<void>;
}

function createHarness(options: HarnessOptions = {}) {
  const order: string[] = [];
  const diagnosticLog = new DevelopmentLog({ enabled: true, capacity: 100 });
  const diagnostics = new StructuredDevelopmentDiagnostics({ enabled: true, log: diagnosticLog });
  const picker: DocumentPickerDependency = {
    getDocumentAsync: jest.fn(async (pickerOptions) => {
      order.push('audio-picker');
      expect(pickerOptions).toEqual({
        type: [...AUDIO_DOCUMENT_PICKER_MIME_TYPES],
        multiple: false,
        copyToCacheDirectory: false,
      });
      return options.pickerResult ?? pickerResult();
    }),
  };
  let progressListener: ((event: ImportProgressEvent) => void) | null = null;
  const subscription: TempoLoopMediaSubscription = {
    remove: jest.fn(() => order.push('unsubscribe')),
  };
  const media: ImportMediaDependency = {
    pickGalleryVideo: jest.fn(async () => {
      order.push('gallery-picker');
      return options.galleryResult === undefined
        ? {
            uri: CONTENT_URI,
            sizeBytes: VIDEO_BYTES,
            mimeType: 'video/quicktime',
            fileName: 'practice.mov',
          }
        : options.galleryResult;
    }),
    inspectMedia: jest.fn(async (inspectOptions: InspectMediaOptions) => {
      order.push('inspect');
      expect(inspectOptions).toEqual({
        sourceUri: CONTENT_URI,
        maxAudioSourceBytes: MAX_AUDIO_BYTES,
        maxVideoSourceBytes: MAX_VIDEO_BYTES,
      });
      return options.inspection ?? INSPECTION;
    }),
    importProjectMedia: jest.fn(async (importOptions: ImportMediaOptions) => {
      order.push('native-import');
      expect(importOptions).toEqual({
        operationId: OPERATION_ID,
        sourceUri: CONTENT_URI,
        outputAudioUri: PARTIAL_URI,
        waveformBinCount: WAVEFORM_POINT_COUNT,
        maxAudioSourceBytes: MAX_AUDIO_BYTES,
        maxVideoSourceBytes: MAX_VIDEO_BYTES,
      });
      return await (options.result ?? mediaResult());
    }),
    cancelImport: jest.fn(async () => {
      order.push('native-cancel');
    }),
    addImportProgressListener: jest.fn((listener) => {
      order.push('subscribe');
      progressListener = listener;
      return subscription;
    }),
  };
  const finalizedInputs: FinalizeImportInput[] = [];
  const repository: ImportProjectRepository = {
    initialize: jest.fn(async () => {
      order.push('repository-init');
    }),
    createImportDirectory: jest.fn(() => {
      order.push('create-import-directory');
      return `file:///documents/TempoLoop/imports/.import-${PROJECT_ID}`;
    }),
    removeImportDirectory: jest.fn(() => {
      order.push('remove-import-directory');
    }),
    finalizeImport: jest.fn(async (input) => {
      order.push('finalize');
      finalizedInputs.push(input);
      return project(input);
    }),
  };
  const keepAwake: KeepAwakeDependency = {
    activate: jest.fn(async (tag) => {
      expect(tag).toBe(IMPORT_KEEP_AWAKE_TAG);
      order.push('keep-awake-on');
    }),
    deactivate: jest.fn(async (tag) => {
      expect(tag).toBe(IMPORT_KEEP_AWAKE_TAG);
      order.push('keep-awake-off');
    }),
  };
  const audioValidator: PartialAudioValidator = {
    validateLoadable: jest.fn(async (uri) => {
      expect(uri).toBe(PARTIAL_URI);
      order.push('audio-load-check');
    }),
    clearSource: jest.fn(() => order.push('audio-clear')),
  };
  const refreshProjects = jest.fn(
    options.refresh ?? (async () => order.push('refresh') as unknown as void),
  );
  const uuids = [SELECTION_ID, OPERATION_ID, PROJECT_ID];
  const coordinator = new ImportCoordinator({
    picker,
    media,
    repository,
    keepAwake,
    audioValidator,
    layout: { importPartialAudioUri: () => PARTIAL_URI },
    importState: useImportStore.getState(),
    refreshProjects,
    randomUuid: () => uuids.shift() ?? '33333333-3333-4333-8333-333333333333',
    diagnostics,
  });

  return {
    coordinator,
    picker,
    media,
    repository,
    keepAwake,
    audioValidator,
    refreshProjects,
    finalizedInputs,
    order,
    diagnosticLog,
    emitProgress(event: ImportProgressEvent) {
      progressListener?.(event);
    },
  };
}

async function select(harness: ReturnType<typeof createHarness>): Promise<SelectedMedia> {
  const selection = await harness.coordinator.selectVideoFromGallery();
  expect(selection).not.toBeNull();
  return selection!;
}

beforeEach(() => {
  useImportStore.getState().reset();
});

describe('ImportCoordinator selection', () => {
  it('uses one opaque Android gallery selection and stores only small metadata', async () => {
    const harness = createHarness();

    await expect(harness.coordinator.selectVideoFromGallery()).resolves.toEqual({
      selectionId: SELECTION_ID,
      sourceKindHint: 'video',
      uri: CONTENT_URI,
      sizeBytes: VIDEO_BYTES,
      mimeType: 'video/quicktime',
      fileName: 'practice.mov',
      suggestedName: 'practice',
    });

    expect(useImportStore.getState()).toMatchObject({
      status: 'selected',
      sourceUri: CONTENT_URI,
      sourceMetadata: {
        sourceKindHint: 'video',
        displayName: 'practice.mov',
        sizeBytes: VIDEO_BYTES,
        mimeType: 'video/quicktime',
      },
    });
  });

  it('returns to idle when the native gallery picker is cancelled', async () => {
    const harness = createHarness({ galleryResult: null });

    await expect(harness.coordinator.selectVideoFromGallery()).resolves.toBeNull();
    expect(useImportStore.getState()).toMatchObject({ status: 'idle', sourceUri: null });
  });

  it('selects audio with the no-copy document picker and applies the 200 MiB hint limit', async () => {
    const harness = createHarness({
      pickerResult: pickerResult({
        name: 'practice.mp3',
        mimeType: 'audio/mpeg',
        size: MAX_AUDIO_BYTES,
      }),
    });

    await expect(harness.coordinator.selectAudio()).resolves.toMatchObject({
      sourceKindHint: 'audio',
      fileName: 'practice.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: MAX_AUDIO_BYTES,
    });
    expect(harness.picker.getDocumentAsync).toHaveBeenCalledWith({
      type: ['audio/*', 'application/octet-stream', 'video/iso.segment'],
      multiple: false,
      copyToCacheDirectory: false,
    });
  });

  it('allows an opaque M4S document to continue to authoritative native inspection', async () => {
    const harness = createHarness({
      pickerResult: pickerResult({
        name: 'renamed-track.m4s',
        mimeType: 'application/octet-stream',
        size: 17 * 1024 * 1024,
      }),
    });

    await expect(harness.coordinator.selectAudio()).resolves.toMatchObject({
      sourceKindHint: 'audio',
      fileName: 'renamed-track.m4s',
      mimeType: 'application/octet-stream',
      suggestedName: 'renamed-track',
    });
  });

  it('rejects audio metadata above 200 MiB before naming', async () => {
    const harness = createHarness({
      pickerResult: pickerResult({
        name: 'oversized.mp3',
        mimeType: 'audio/mpeg',
        size: MAX_AUDIO_BYTES + 1,
      }),
    });

    await expect(harness.coordinator.selectAudio()).rejects.toMatchObject({
      code: 'E_AUDIO_TOO_LARGE',
      details: { maxSizeBytes: MAX_AUDIO_BYTES },
    });
    expect(useImportStore.getState().status).toBe('failed');
  });

  it.each([undefined, 0])('treats audio picker size %p as unknown', async (size) => {
    const harness = createHarness({ pickerResult: pickerResult({ size }) });
    await expect(harness.coordinator.selectAudio()).resolves.toMatchObject({
      sourceKindHint: 'audio',
      sizeBytes: null,
    });
  });

  it('rejects a second selection until the first is discarded', async () => {
    const harness = createHarness();
    const selection = await select(harness);
    await expect(harness.coordinator.selectVideoFromGallery()).rejects.toMatchObject({
      code: 'E_IMPORT_IN_PROGRESS',
    });

    harness.coordinator.discardSelection(selection);
    expect(useImportStore.getState().sourceUri).toBeNull();
  });

  it('uses a safe fallback when picker display metadata is not a valid project name', () => {
    expect(suggestedProjectName('unsafe/name.mov', CONTENT_URI)).toBe(
      COPY.import.untitledProjectName,
    );
  });
});

describe('ImportCoordinator transaction', () => {
  it('runs inspect, native import, expo-audio validation, atomic finalize, and refresh in order', async () => {
    const harness = createHarness();
    const selection = await select(harness);

    await expect(
      harness.coordinator.importProject({ selection, name: '  Practice Track  ' }),
    ).resolves.toMatchObject({ id: PROJECT_ID, name: 'Practice Track' });

    expect(harness.order).toEqual([
      'gallery-picker',
      'repository-init',
      'create-import-directory',
      'subscribe',
      'keep-awake-on',
      'inspect',
      'native-import',
      'audio-load-check',
      'finalize',
      'refresh',
      'unsubscribe',
      'audio-clear',
      'keep-awake-off',
    ]);
    expect(harness.finalizedInputs).toEqual([
      {
        projectId: PROJECT_ID,
        name: 'Practice Track',
        sourceDisplayName: 'practice.mov',
        inspection: INSPECTION,
        result: mediaResult(),
      },
    ]);
    expect(useImportStore.getState()).toMatchObject({
      status: 'completed',
      operationId: OPERATION_ID,
      projectId: PROJECT_ID,
      sourceUri: null,
      sourceMetadata: null,
    });
    expect(harness.diagnosticLog.getEntries().map((entry) => entry.event)).toEqual([
      'import.started',
      'import.stage',
      'import.source.inspected',
      'import.export.completed',
      'import.waveform.completed',
      'import.completed',
    ]);
    const diagnosticJson = JSON.stringify(harness.diagnosticLog.getEntries());
    expect(diagnosticJson).toContain(OPERATION_ID);
    expect(diagnosticJson).not.toContain('Practice Track');
    expect(diagnosticJson).not.toContain(CONTENT_URI);
    expect(diagnosticJson).not.toContain('practice.mov');
    expect(diagnosticJson).not.toContain('"waveform":[');
    expect(diagnosticJson).not.toContain('"samples"');
  });

  it('runs an MP3 selection through the same M4A and waveform transaction', async () => {
    const audioInspection: MediaInspection = {
      ...INSPECTION,
      sourceKind: 'audio',
      sourceSizeBytes: 12 * 1024 * 1024,
      audioMimeType: 'audio/mpeg',
    };
    const harness = createHarness({
      pickerResult: pickerResult({
        name: 'dance-track.mp3',
        mimeType: 'audio/mpeg',
        size: audioInspection.sourceSizeBytes ?? undefined,
      }),
      inspection: audioInspection,
    });
    const selection = await harness.coordinator.selectAudio();
    expect(selection).not.toBeNull();

    await expect(
      harness.coordinator.importProject({ selection: selection!, name: 'Dance Track' }),
    ).resolves.toMatchObject({ name: 'Dance Track', audioFileName: 'audio.m4a' });
    expect(harness.finalizedInputs[0]).toMatchObject({
      sourceDisplayName: 'dance-track.mp3',
      inspection: audioInspection,
    });
  });

  it('imports MP3 content renamed with an M4S extension through the audio transaction', async () => {
    const audioInspection: MediaInspection = {
      ...INSPECTION,
      sourceKind: 'audio',
      sourceSizeBytes: 17 * 1024 * 1024,
      audioMimeType: 'audio/mpeg',
    };
    const harness = createHarness({
      pickerResult: pickerResult({
        name: 'dance-track.m4s',
        mimeType: 'video/iso.segment',
        size: audioInspection.sourceSizeBytes ?? undefined,
      }),
      inspection: audioInspection,
    });
    const selection = await harness.coordinator.selectAudio();
    expect(selection).not.toBeNull();

    await expect(
      harness.coordinator.importProject({ selection: selection!, name: 'M4S Track' }),
    ).resolves.toMatchObject({ name: 'M4S Track', audioFileName: 'audio.m4a' });
    expect(harness.finalizedInputs[0]).toMatchObject({
      sourceDisplayName: 'dance-track.m4s',
      inspection: audioInspection,
    });
  });

  it('does not inspect native media until a valid name is submitted', async () => {
    const harness = createHarness();
    const selection = await select(harness);

    await expect(
      harness.coordinator.importProject({ selection, name: ' / ' }),
    ).rejects.toBeDefined();
    expect(harness.media.inspectMedia).not.toHaveBeenCalled();
    expect(harness.repository.createImportDirectory).not.toHaveBeenCalled();
  });

  it('rejects malformed native waveform results and removes only the app import directory', async () => {
    const harness = createHarness({ result: mediaResult({ waveform: [0, 1] }) });
    const selection = await select(harness);

    await expect(
      harness.coordinator.importProject({ selection, name: 'Practice' }),
    ).rejects.toMatchObject({ code: 'E_WAVEFORM_FAILED' });

    expect(harness.media.cancelImport).toHaveBeenCalledWith(OPERATION_ID);
    expect(harness.audioValidator.validateLoadable).not.toHaveBeenCalled();
    expect(harness.repository.finalizeImport).not.toHaveBeenCalled();
    expect(harness.repository.removeImportDirectory).toHaveBeenCalledWith(PROJECT_ID);
    expect(useImportStore.getState()).toMatchObject({ status: 'failed', sourceUri: null });
    expect(harness.diagnosticLog.getEntries()).toContainEqual(
      expect.objectContaining({
        event: 'import.failed',
        context: expect.objectContaining({ operationId: OPERATION_ID, code: 'E_WAVEFORM_FAILED' }),
      }),
    );
  });

  it('rejects a native destination different from the private partial URI', async () => {
    const harness = createHarness({
      result: mediaResult({ audioUri: 'file:///documents/not-the-import/audio.m4a.partial' }),
    });
    const selection = await select(harness);

    await expect(
      harness.coordinator.importProject({ selection, name: 'Practice' }),
    ).rejects.toMatchObject<Partial<ImportCoordinatorError>>({ code: 'E_NATIVE_RESULT_INVALID' });
    expect(harness.repository.removeImportDirectory).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('keeps a committed project if the post-commit refresh fails', async () => {
    const harness = createHarness({
      refresh: async () => {
        throw new Error('refresh failed');
      },
    });
    const selection = await select(harness);

    await expect(
      harness.coordinator.importProject({ selection, name: 'Practice' }),
    ).rejects.toMatchObject({ code: 'E_POST_COMMIT_REFRESH_FAILED' });
    expect(harness.repository.finalizeImport).toHaveBeenCalledTimes(1);
    expect(harness.repository.removeImportDirectory).not.toHaveBeenCalled();
  });

  it('forwards matching native progress and ignores stale operations', async () => {
    const pending = deferred<ImportMediaResult>();
    const harness = createHarness({ result: pending.promise });
    const selection = await select(harness);
    const onProgress = jest.fn();
    const importPromise = harness.coordinator.importProject({
      selection,
      name: 'Practice',
      onProgress,
    });
    await Promise.resolve();
    await Promise.resolve();

    harness.emitProgress({
      operationId: 'stale',
      stage: 'exporting',
      stageProgress: 0.9,
      overallProgress: 0.9,
    });
    harness.emitProgress({
      operationId: OPERATION_ID,
      stage: 'exporting',
      stageProgress: 0.4,
      overallProgress: 0.3,
    });
    harness.emitProgress({
      operationId: OPERATION_ID,
      stage: 'exporting',
      stageProgress: 0.5,
      overallProgress: 0.4,
    });
    pending.resolve(mediaResult());
    await importPromise;

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: OPERATION_ID,
        phase: 'extracting',
        stage: 'exporting',
        progress: 0.3,
      }),
    );
    expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({ operationId: 'stale' }));
    expect(
      harness.diagnosticLog
        .getEntries()
        .filter(
          (entry) =>
            entry.event === 'import.stage' &&
            entry.context !== null &&
            typeof entry.context === 'object' &&
            'stage' in entry.context &&
            entry.context.stage === 'exporting',
        ),
    ).toHaveLength(1);
  });

  it('cancels idempotently, suppresses alerts, unsubscribes, cleans only its import, and releases KeepAwake', async () => {
    const pending = deferred<ImportMediaResult>();
    const harness = createHarness({ result: pending.promise });
    const selection = await select(harness);
    const importPromise = harness.coordinator.importProject({ selection, name: 'Practice' });
    const cancellationExpectation = expect(importPromise).rejects.toMatchObject({
      code: 'E_IMPORT_CANCELLED',
      shouldAlert: false,
    });
    for (
      let index = 0;
      index < 10 && !jest.mocked(harness.media.importProjectMedia).mock.calls.length;
      index += 1
    ) {
      await Promise.resolve();
    }
    expect(harness.media.importProjectMedia).toHaveBeenCalledTimes(1);

    await expect(harness.coordinator.cancelActiveImport()).resolves.toBe(true);
    await expect(harness.coordinator.cancelActiveImport()).resolves.toBe(true);
    pending.reject(new TempoLoopMediaServiceError('E_IMPORT_CANCELLED', 'cancelled'));

    await cancellationExpectation;
    expect(harness.media.cancelImport).toHaveBeenCalledTimes(1);
    expect(harness.repository.removeImportDirectory).toHaveBeenCalledWith(PROJECT_ID);
    expect(harness.keepAwake.deactivate).toHaveBeenCalledWith(IMPORT_KEEP_AWAKE_TAG);
    expect(useImportStore.getState()).toMatchObject({
      status: 'failed',
      sourceUri: null,
      terminalError: { code: 'E_IMPORT_CANCELLED', userMessage: null },
    });
    expect(harness.diagnosticLog.getEntries()).toContainEqual(
      expect.objectContaining({
        event: 'import.canceled',
        context: expect.objectContaining({
          operationId: OPERATION_ID,
          code: 'E_IMPORT_CANCELLED',
        }),
      }),
    );
  });
});

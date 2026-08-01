import { requireNativeModule } from 'expo';

import expoModuleConfig from '../modules/tempoloop-media/expo-module.config.json';
import TempoLoopMedia, {
  IMPORT_STAGES,
  TEMPO_LOOP_MEDIA_ERROR_CODES,
  TempoLoopMediaContractError,
  assertImportMediaResult,
  assertImportProgressEvent,
  assertMediaInspection,
  assertPickedMediaSource,
  createTempoLoopMediaClient,
  type ImportMediaOptions,
  type ImportMediaResult,
  type ImportProgressEvent,
  type InspectMediaOptions,
  type MediaInspection,
  type PickedMediaSource,
  type TempoLoopMediaApi,
  type TempoLoopMediaClient,
  type TempoLoopMediaNativeModule,
} from '../modules/tempoloop-media';

jest.mock('expo', () => ({
  requireNativeModule: jest.fn(),
}));

type IsExactly<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends <Value>() => Value extends Expected ? 1 : 2
    ? true
    : false;

type Assert<Condition extends true> = Condition;

type HasExactApiMethods = Assert<
  IsExactly<
    keyof TempoLoopMediaApi,
    'pickGalleryVideo' | 'inspectMedia' | 'importProjectMedia' | 'cancelImport'
  >
>;
type HasExactInspectOptions = Assert<
  IsExactly<keyof InspectMediaOptions, 'sourceUri' | 'maxAudioSourceBytes' | 'maxVideoSourceBytes'>
>;
type HasExactImportOptions = Assert<
  IsExactly<
    keyof ImportMediaOptions,
    | 'operationId'
    | 'sourceUri'
    | 'outputAudioUri'
    | 'waveformBinCount'
    | 'maxAudioSourceBytes'
    | 'maxVideoSourceBytes'
  >
>;
type HasExactInspectionResult = Assert<
  IsExactly<
    keyof MediaInspection,
    | 'sourceKind'
    | 'sourceSizeBytes'
    | 'durationMs'
    | 'audioMimeType'
    | 'sampleRate'
    | 'channelCount'
  >
>;
type HasExactImportResult = Assert<
  IsExactly<keyof ImportMediaResult, 'audioUri' | 'audioSizeBytes' | 'durationMs' | 'waveform'>
>;
type HasExactProgressEvent = Assert<
  IsExactly<
    keyof ImportProgressEvent,
    'operationId' | 'stage' | 'stageProgress' | 'overallProgress'
  >
>;
type HasTypedListener = Assert<
  IsExactly<
    Parameters<TempoLoopMediaClient['addImportProgressListener']>[0],
    (event: ImportProgressEvent) => void
  >
>;

const TYPE_ASSERTIONS: [
  HasExactApiMethods,
  HasExactInspectOptions,
  HasExactImportOptions,
  HasExactInspectionResult,
  HasExactImportResult,
  HasExactProgressEvent,
  HasTypedListener,
] = [true, true, true, true, true, true, true];

const VALID_PICKED_SOURCE: PickedMediaSource = {
  uri: 'content://media/external/video/media/42',
  sizeBytes: 10_000,
  mimeType: 'video/mp4',
  fileName: 'dance.mp4',
};

const VALID_INSPECTION: MediaInspection = {
  sourceKind: 'video',
  sourceSizeBytes: null,
  durationMs: 90_001,
  audioMimeType: 'audio/mp4a-latm',
  sampleRate: 48_000,
  channelCount: 2,
};

const VALID_IMPORT_RESULT: ImportMediaResult = {
  audioUri: 'file:///data/user/0/com.tempoloop.app/files/audio.m4a.partial',
  audioSizeBytes: 12_345,
  durationMs: 90_001,
  waveform: [0, 0.25, 1, 0.5],
};

function createNativeModule(
  overrides: Partial<TempoLoopMediaNativeModule> = {},
): TempoLoopMediaNativeModule {
  return {
    pickGalleryVideo: jest.fn(async () => VALID_PICKED_SOURCE),
    inspectMedia: jest.fn(async () => VALID_INSPECTION),
    importProjectMedia: jest.fn(async () => VALID_IMPORT_RESULT),
    cancelImport: jest.fn(async () => undefined),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    ...overrides,
  };
}

describe('TempoLoopMedia TypeScript contract', () => {
  it('registers only the Android native module', () => {
    expect(expoModuleConfig).toEqual({
      platforms: ['android'],
      android: {
        modules: ['expo.modules.tempoloopmedia.TempoLoopMediaModule'],
      },
    });
    expect('apple' in expoModuleConfig).toBe(false);
    expect('ios' in expoModuleConfig).toBe(false);
  });

  it('keeps the public methods, records, and typed listener exact', () => {
    expect(TYPE_ASSERTIONS).toEqual([true, true, true, true, true, true, true]);
    expect(IMPORT_STAGES).toEqual(['inspecting', 'exporting', 'waveform', 'finalizing']);
  });

  it('exports every stable error code from the Android contract', () => {
    expect(TEMPO_LOOP_MEDIA_ERROR_CODES).toEqual([
      'E_VIDEO_TOO_LARGE',
      'E_AUDIO_TOO_LARGE',
      'E_PICKER_UNAVAILABLE',
      'E_SOURCE_UNREADABLE',
      'E_NO_AUDIO_TRACK',
      'E_DRM_UNSUPPORTED',
      'E_INVALID_DURATION',
      'E_STORAGE_LOW',
      'E_IMPORT_BUSY',
      'E_IMPORT_CANCELLED',
      'E_UNSUPPORTED_MEDIA',
      'E_OUTPUT_WRITE_FAILED',
      'E_EXPORT_EMPTY',
      'E_WAVEFORM_FAILED',
      'E_INVALID_RANGE',
      'E_AUDIO_NOT_FOUND',
      'E_AUDIO_LOAD_FAILED',
      'E_PLAYBACK_COMMAND_STALE',
      'E_PATH_OUTSIDE_APP',
      'E_PROJECT_CORRUPT',
      'E_UNKNOWN_NATIVE',
    ]);
  });

  it('validates integer inspection times returned by native code', async () => {
    const native = createNativeModule({
      inspectMedia: jest.fn(
        async () => ({ ...VALID_INSPECTION, durationMs: 90_000.5 }) as MediaInspection,
      ),
    });
    const client = createTempoLoopMediaClient(() => native);

    await expect(
      client.inspectMedia({
        sourceUri: 'content://provider/video/1',
        maxAudioSourceBytes: 50,
        maxVideoSourceBytes: 100,
      }),
    ).rejects.toMatchObject({
      code: 'E_INVALID_DURATION',
    });
  });

  it('treats gallery cancellation as null and validates non-cancelled picker metadata', async () => {
    const cancelled = createTempoLoopMediaClient(() =>
      createNativeModule({ pickGalleryVideo: jest.fn(async () => null) }),
    );
    await expect(cancelled.pickGalleryVideo()).resolves.toBeNull();

    const malformed = createTempoLoopMediaClient(() =>
      createNativeModule({
        pickGalleryVideo: jest.fn(
          async () => ({ ...VALID_PICKED_SOURCE, uri: 'https://example.com/video.mp4' }) as never,
        ),
      }),
    );
    await expect(malformed.pickGalleryVideo()).rejects.toMatchObject({
      code: 'E_SOURCE_UNREADABLE',
    });
  });

  it('preserves unknown source sizes as null and rejects a fake zero size', () => {
    expect(() => assertMediaInspection(VALID_INSPECTION)).not.toThrow();
    expect(() => assertMediaInspection({ ...VALID_INSPECTION, sourceSizeBytes: 0 })).toThrow(
      TempoLoopMediaContractError,
    );
  });

  it('uses waveformBinCount and rejects an invalid waveform result', async () => {
    const native = createNativeModule();
    const client = createTempoLoopMediaClient(() => native);
    const options: ImportMediaOptions = {
      operationId: 'operation-1',
      sourceUri: 'content://provider/video/1',
      outputAudioUri: 'file:///data/user/0/com.tempoloop.app/files/audio.m4a.partial',
      waveformBinCount: 3,
      maxAudioSourceBytes: 209_715_200,
      maxVideoSourceBytes: 629_145_600,
    };

    await expect(client.importProjectMedia(options)).rejects.toMatchObject({
      code: 'E_WAVEFORM_FAILED',
    });
    expect(native.importProjectMedia).toHaveBeenCalledWith(options);
  });

  it('accepts finite, bounded waveform samples with the requested bin count', () => {
    expect(() => assertImportMediaResult(VALID_IMPORT_RESULT, 4)).not.toThrow();
    expect(() =>
      assertImportMediaResult({ ...VALID_IMPORT_RESULT, waveform: [0, Number.NaN, 1, 0] }, 4),
    ).toThrow(TempoLoopMediaContractError);
  });

  it('validates inspection and progress records before application use', () => {
    expect(() => assertMediaInspection(VALID_INSPECTION)).not.toThrow();
    expect(() => assertPickedMediaSource(VALID_PICKED_SOURCE)).not.toThrow();
    expect(() =>
      assertImportProgressEvent({
        operationId: 'operation-1',
        stage: 'exporting',
        stageProgress: 0.5,
        overallProgress: null,
      }),
    ).not.toThrow();
    expect(() =>
      assertImportProgressEvent({
        operationId: 'operation-1',
        stage: 'exporting',
        stageProgress: 1.01,
        overallProgress: 0.5,
      }),
    ).toThrow(TempoLoopMediaContractError);
  });

  it('delivers only runtime-validated progress events through the typed listener', () => {
    let nativeListener: ((event: unknown) => void) | undefined;
    const remove = jest.fn();
    const native = createNativeModule({
      addListener: jest.fn((_eventName, listener) => {
        nativeListener = listener;
        return { remove };
      }),
    });
    const listener = jest.fn();
    const subscription = createTempoLoopMediaClient(() => native).addImportProgressListener(
      listener,
    );
    const event: ImportProgressEvent = {
      operationId: 'operation-1',
      stage: 'waveform',
      stageProgress: 0.75,
      overallProgress: 0.8,
    };

    nativeListener?.(event);
    expect(listener).toHaveBeenCalledWith(event);
    expect(() => nativeListener?.({ ...event, overallProgress: Number.POSITIVE_INFINITY })).toThrow(
      TempoLoopMediaContractError,
    );

    subscription.remove();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('lazily requires the real native module without an optional or JavaScript fallback', async () => {
    const native = createNativeModule();
    jest.mocked(requireNativeModule).mockReturnValue(native);

    expect(requireNativeModule).not.toHaveBeenCalled();
    await expect(
      TempoLoopMedia.inspectMedia({
        sourceUri: 'file:///data/user/0/com.tempoloop.app/files/source.mp4',
        maxAudioSourceBytes: 209_715_200,
        maxVideoSourceBytes: 629_145_600,
      }),
    ).resolves.toEqual(VALID_INSPECTION);
    expect(requireNativeModule).toHaveBeenCalledTimes(1);
    expect(requireNativeModule).toHaveBeenCalledWith('TempoLoopMedia');
  });
});

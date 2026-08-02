import type {
  ImportMediaOptions,
  ImportMediaResult,
  ImportProgressEvent,
  ImportProgressListener,
  GenerateWaveformOptions,
  GenerateWaveformResult,
  WaveformProgressListener,
  InspectMediaOptions,
  MediaInspection,
  PickedMediaSource,
  TempoLoopMediaClient,
  TempoLoopMediaSubscription,
} from '../modules/tempoloop-media';

import {
  TempoLoopMediaService,
  TempoLoopMediaServiceError,
  toTempoLoopMediaServiceError,
} from '@/services/TempoLoopMediaService';

const INSPECT_OPTIONS: InspectMediaOptions = {
  sourceUri: 'content://provider/video/1',
  maxAudioSourceBytes: 209_715_200,
  maxVideoSourceBytes: 629_145_600,
};

const INSPECTION: MediaInspection = {
  sourceKind: 'video',
  sourceSizeBytes: 1_000_000,
  durationMs: 90_000,
  audioMimeType: 'audio/mp4a-latm',
  sampleRate: 48_000,
  channelCount: 2,
};

const IMPORT_OPTIONS: ImportMediaOptions = {
  operationId: 'operation-1',
  sourceUri: INSPECT_OPTIONS.sourceUri,
  outputAudioUri: 'file:///private/imports/audio.m4a.partial',
  maxAudioSourceBytes: INSPECT_OPTIONS.maxAudioSourceBytes,
  maxVideoSourceBytes: INSPECT_OPTIONS.maxVideoSourceBytes,
};

const IMPORT_RESULT: ImportMediaResult = {
  audioUri: IMPORT_OPTIONS.outputAudioUri,
  audioSizeBytes: 250_000,
  durationMs: 90_000,
};

const WAVEFORM_OPTIONS: GenerateWaveformOptions = {
  operationId: 'waveform-1',
  audioUri: IMPORT_OPTIONS.outputAudioUri,
  durationMs: 90_000,
  waveformBinCount: 4,
};

const WAVEFORM_RESULT: GenerateWaveformResult = {
  durationMs: 90_000,
  sampleCount: 4,
  samples: [0, 0.25, 0.5, 1],
  decodedFrameCount: 4_320_000,
  sampledFrameCount: 1_024,
  elapsedMs: 200,
};

interface ClientMock {
  readonly client: TempoLoopMediaClient;
  readonly pickGalleryVideo: jest.MockedFunction<TempoLoopMediaClient['pickGalleryVideo']>;
  readonly inspectMedia: jest.MockedFunction<TempoLoopMediaClient['inspectMedia']>;
  readonly importProjectMedia: jest.MockedFunction<TempoLoopMediaClient['importProjectMedia']>;
  readonly cancelImport: jest.MockedFunction<TempoLoopMediaClient['cancelImport']>;
  readonly addImportProgressListener: jest.MockedFunction<
    TempoLoopMediaClient['addImportProgressListener']
  >;
  readonly removeSubscription: jest.Mock;
  emitProgress(event: unknown): void;
}

function createClientMock(): ClientMock {
  let progressListener: ImportProgressListener | undefined;
  const removeSubscription = jest.fn();
  const pickedSource: PickedMediaSource = {
    uri: INSPECT_OPTIONS.sourceUri,
    sizeBytes: 1_000_000,
    mimeType: 'video/mp4',
    fileName: 'dance.mp4',
  };
  const pickGalleryVideo = jest.fn(async () => pickedSource);
  const inspectMedia = jest.fn<Promise<MediaInspection>, [InspectMediaOptions]>(
    async () => INSPECTION,
  );
  const importProjectMedia = jest.fn<Promise<ImportMediaResult>, [ImportMediaOptions]>(
    async () => IMPORT_RESULT,
  );
  const cancelImport = jest.fn<Promise<void>, [string]>(async () => undefined);
  const generateWaveform = jest.fn<Promise<GenerateWaveformResult>, [GenerateWaveformOptions]>(
    async () => WAVEFORM_RESULT,
  );
  const cancelWaveform = jest.fn<Promise<void>, [string]>(async () => undefined);
  const addImportProgressListener = jest.fn<TempoLoopMediaSubscription, [ImportProgressListener]>(
    (listener) => {
      progressListener = listener;
      return { remove: removeSubscription };
    },
  );
  const addWaveformProgressListener = jest.fn<
    TempoLoopMediaSubscription,
    [WaveformProgressListener]
  >((_listener) => {
    return { remove: jest.fn() };
  });

  return {
    client: {
      pickGalleryVideo,
      inspectMedia,
      importProjectMedia,
      cancelImport,
      addImportProgressListener,
      generateWaveform,
      cancelWaveform,
      addWaveformProgressListener,
    },
    pickGalleryVideo,
    inspectMedia,
    importProjectMedia,
    cancelImport,
    addImportProgressListener,
    removeSubscription,
    emitProgress(event) {
      progressListener?.(event as ImportProgressEvent);
    },
  };
}

describe('TempoLoopMediaService', () => {
  it('delegates inspection, import, and cancellation through the typed client', async () => {
    const native = createClientMock();
    const service = new TempoLoopMediaService(native.client);

    await expect(service.pickGalleryVideo()).resolves.toEqual({
      uri: INSPECT_OPTIONS.sourceUri,
      sizeBytes: 1_000_000,
      mimeType: 'video/mp4',
      fileName: 'dance.mp4',
    });
    await expect(service.inspectMedia(INSPECT_OPTIONS)).resolves.toEqual(INSPECTION);
    await expect(service.importProjectMedia(IMPORT_OPTIONS)).resolves.toEqual(IMPORT_RESULT);
    await expect(service.cancelImport('operation-1')).resolves.toBeUndefined();

    expect(native.pickGalleryVideo).toHaveBeenCalledTimes(1);
    expect(native.inspectMedia).toHaveBeenCalledWith(INSPECT_OPTIONS);
    expect(native.importProjectMedia).toHaveBeenCalledWith(IMPORT_OPTIONS);
    expect(native.cancelImport).toHaveBeenCalledWith('operation-1');
  });

  it('validates native inspection and waveform results at the service boundary', async () => {
    const native = createClientMock();
    const service = new TempoLoopMediaService(native.client);
    native.inspectMedia.mockResolvedValueOnce({
      ...INSPECTION,
      durationMs: 0,
    });

    await expect(service.inspectMedia(INSPECT_OPTIONS)).rejects.toMatchObject({
      code: 'E_INVALID_DURATION',
      userMessage: 'This media has an invalid duration. Select another file.',
    });

    native.client.generateWaveform = jest.fn(async () => ({
      ...WAVEFORM_RESULT,
      samples: [0, Number.NaN, 1, 0.5],
    }));

    await expect(service.generateWaveform(WAVEFORM_OPTIONS)).rejects.toMatchObject({
      code: 'E_WAVEFORM_FAILED',
      userMessage: 'TempoLoop could not build the waveform. Retry waveform generation.',
    });
  });

  it('maps stable native codes to safe actionable English copy', async () => {
    const native = createClientMock();
    native.inspectMedia.mockRejectedValueOnce(
      Object.assign(new Error('Provider failed at content://private/source'), {
        code: 'E_SOURCE_UNREADABLE',
      }),
    );
    const service = new TempoLoopMediaService(native.client);

    const promise = service.inspectMedia(INSPECT_OPTIONS);
    await expect(promise).rejects.toMatchObject({
      name: 'TempoLoopMediaServiceError',
      code: 'E_SOURCE_UNREADABLE',
      userMessage:
        'TempoLoop could not open this media. Select it again or copy it to local storage.',
      technicalMessage: 'Provider failed at content://private/source',
      shouldAlert: true,
    } satisfies Partial<TempoLoopMediaServiceError>);
    await expect(promise).rejects.not.toHaveProperty(
      'message',
      'Provider failed at content://private/source',
    );
  });

  it('collapses unknown native codes and values to E_UNKNOWN_NATIVE', () => {
    expect(
      toTempoLoopMediaServiceError({ code: 'E_VENDOR_PRIVATE', message: 'Native stack trace' }),
    ).toMatchObject({
      code: 'E_UNKNOWN_NATIVE',
      userMessage: 'TempoLoop could not complete that media operation. Try again.',
      technicalMessage: 'Native stack trace',
    });
  });

  it('treats import cancellation as a silent terminal state', () => {
    const error = toTempoLoopMediaServiceError({
      code: 'E_IMPORT_CANCELLED',
      message: 'Transformer cancellation completed',
    });

    expect(error).toMatchObject({
      code: 'E_IMPORT_CANCELLED',
      userMessage: null,
      isCancellation: true,
      shouldAlert: false,
      message: 'Import cancelled.',
    });
  });

  it('forwards only valid progress and removes the native listener once', () => {
    const native = createClientMock();
    const service = new TempoLoopMediaService(native.client);
    const listener = jest.fn();
    const subscription = service.addImportProgressListener(listener);
    const validEvent: ImportProgressEvent = {
      operationId: 'operation-1',
      stage: 'exporting',
      stageProgress: 0.5,
      overallProgress: 0.35,
    };

    native.emitProgress(validEvent);
    native.emitProgress({ ...validEvent, overallProgress: Number.NaN });
    native.emitProgress({ ...validEvent, stage: 'uploading' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(validEvent);

    subscription.remove();
    subscription.remove();
    expect(native.removeSubscription).toHaveBeenCalledTimes(1);
  });

  it('maps synchronous listener registration failures', () => {
    const native = createClientMock();
    native.addImportProgressListener.mockImplementationOnce(() => {
      throw Object.assign(new Error('Emitter unavailable'), { code: 'E_UNKNOWN_NATIVE' });
    });
    const service = new TempoLoopMediaService(native.client);

    expect(() => service.addImportProgressListener(jest.fn())).toThrow(TempoLoopMediaServiceError);
  });
});

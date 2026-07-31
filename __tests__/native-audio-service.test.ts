import type {
  DanceAudioEvents,
  ExtractAudioResult,
  HealthCheckResult,
  PlaybackSnapshot,
} from '../modules/dance-audio';
import {
  NativeAudioService,
  type NativeAudioModuleDependency,
  type NativeAudioSubscription,
} from '@/services/NativeAudioService';
import { AppError } from '@/utils/errors';

const READY_SNAPSHOT: PlaybackSnapshot = {
  state: 'ready',
  currentTimeMs: 0,
  durationMs: 90_000,
  rate: 1,
  activeRangeStartMs: null,
  activeRangeEndMs: null,
};

interface NativeMock {
  dependency: NativeAudioModuleDependency;
  addListener: jest.Mock;
  methods: {
    healthCheck: jest.MockedFunction<() => Promise<HealthCheckResult>>;
    extractAudio: jest.MockedFunction<
      (taskId: string, inputVideoUri: string, outputAudioUri: string) => Promise<ExtractAudioResult>
    >;
    generateWaveform: jest.MockedFunction<
      (taskId: string, audioUri: string, pointCount: number) => Promise<number[]>
    >;
    cancelTask: jest.MockedFunction<(taskId: string) => Promise<void>>;
    loadAudio: jest.MockedFunction<(audioUri: string) => Promise<PlaybackSnapshot>>;
    playRange: jest.MockedFunction<
      (startMs: number, endMs: number, rate: 1 | 0.9 | 0.8 | 0.7) => Promise<PlaybackSnapshot>
    >;
    playFrom: jest.MockedFunction<
      (positionMs: number, rate: 1 | 0.9 | 0.8 | 0.7) => Promise<PlaybackSnapshot>
    >;
    pause: jest.MockedFunction<() => Promise<PlaybackSnapshot>>;
    resume: jest.MockedFunction<() => Promise<PlaybackSnapshot>>;
    seek: jest.MockedFunction<(positionMs: number) => Promise<PlaybackSnapshot>>;
    setRate: jest.MockedFunction<(rate: 1 | 0.9 | 0.8 | 0.7) => Promise<PlaybackSnapshot>>;
    stopAndSeek: jest.MockedFunction<(positionMs: number) => Promise<PlaybackSnapshot>>;
    getPlaybackSnapshot: jest.MockedFunction<() => Promise<PlaybackSnapshot>>;
    unload: jest.MockedFunction<() => Promise<void>>;
  };
}

function createNativeMock(): NativeMock {
  const methods: NativeMock['methods'] = {
    healthCheck: jest.fn<Promise<HealthCheckResult>, []>(async () => ({
      available: true,
      apiVersion: 1,
    })),
    extractAudio: jest.fn<
      Promise<ExtractAudioResult>,
      [taskId: string, inputVideoUri: string, outputAudioUri: string]
    >(async () => ({
      durationMs: 90_000,
      outputBytes: 1_024,
    })),
    generateWaveform: jest.fn<
      Promise<number[]>,
      [taskId: string, audioUri: string, pointCount: number]
    >(async () => [0, 0.5, 1]),
    cancelTask: jest.fn<Promise<void>, [taskId: string]>(async () => undefined),
    loadAudio: jest.fn<Promise<PlaybackSnapshot>, [audioUri: string]>(async () => READY_SNAPSHOT),
    playRange: jest.fn<
      Promise<PlaybackSnapshot>,
      [startMs: number, endMs: number, rate: 1 | 0.9 | 0.8 | 0.7]
    >(async () => ({
      ...READY_SNAPSHOT,
      state: 'playing',
      currentTimeMs: 4_000,
      rate: 0.8,
      activeRangeStartMs: 4_000,
      activeRangeEndMs: 12_000,
    })),
    playFrom: jest.fn<Promise<PlaybackSnapshot>, [positionMs: number, rate: 1 | 0.9 | 0.8 | 0.7]>(
      async () => ({
        ...READY_SNAPSHOT,
        state: 'playing',
      }),
    ),
    pause: jest.fn<Promise<PlaybackSnapshot>, []>(async () => ({
      ...READY_SNAPSHOT,
      state: 'paused',
    })),
    resume: jest.fn<Promise<PlaybackSnapshot>, []>(async () => ({
      ...READY_SNAPSHOT,
      state: 'playing',
    })),
    seek: jest.fn<Promise<PlaybackSnapshot>, [positionMs: number]>(async () => READY_SNAPSHOT),
    setRate: jest.fn<Promise<PlaybackSnapshot>, [rate: 1 | 0.9 | 0.8 | 0.7]>(
      async () => READY_SNAPSHOT,
    ),
    stopAndSeek: jest.fn<Promise<PlaybackSnapshot>, [positionMs: number]>(
      async () => READY_SNAPSHOT,
    ),
    getPlaybackSnapshot: jest.fn<Promise<PlaybackSnapshot>, []>(async () => READY_SNAPSHOT),
    unload: jest.fn<Promise<void>, []>(async () => undefined),
  };
  const addListener = jest.fn();
  const subscription: NativeAudioSubscription = {
    remove: jest.fn(),
  };

  const dependency: NativeAudioModuleDependency = {
    ...methods,
    addListener: <EventName extends keyof DanceAudioEvents>(
      eventName: EventName,
      listener: DanceAudioEvents[EventName],
    ) => {
      addListener(eventName, listener);
      return subscription;
    },
  };

  return { dependency, addListener, methods };
}

describe('NativeAudioService', () => {
  it('delegates the complete typed command surface without media data handling', async () => {
    const native = createNativeMock();
    const service = new NativeAudioService(native.dependency);

    await expect(service.healthCheck()).resolves.toEqual({
      available: true,
      apiVersion: 1,
    });
    await expect(
      service.extractAudio('task-1', 'file:///cache/input.mov', 'file:///cache/audio.m4a'),
    ).resolves.toEqual({ durationMs: 90_000, outputBytes: 1_024 });
    await expect(
      service.generateWaveform('task-1', 'file:///cache/audio.m4a', 2_048),
    ).resolves.toEqual([0, 0.5, 1]);
    await service.cancelTask('task-1');
    await service.loadAudio('file:///documents/audio.m4a');
    await service.playRange(4_000, 12_000, 0.8);
    await service.playFrom(3_000, 0.9);
    await service.pause();
    await service.resume();
    await service.seek(5_000);
    await service.setRate(0.7);
    await service.stopAndSeek(2_000);
    await service.getPlaybackSnapshot();
    await service.unload();

    expect(native.methods.extractAudio).toHaveBeenCalledWith(
      'task-1',
      'file:///cache/input.mov',
      'file:///cache/audio.m4a',
    );
    expect(native.methods.generateWaveform).toHaveBeenCalledWith(
      'task-1',
      'file:///cache/audio.m4a',
      2_048,
    );
    expect(native.methods.cancelTask).toHaveBeenCalledWith('task-1');
    expect(native.methods.loadAudio).toHaveBeenCalledWith('file:///documents/audio.m4a');
    expect(native.methods.playRange).toHaveBeenCalledWith(4_000, 12_000, 0.8);
    expect(native.methods.playFrom).toHaveBeenCalledWith(3_000, 0.9);
    expect(native.methods.pause).toHaveBeenCalledTimes(1);
    expect(native.methods.resume).toHaveBeenCalledTimes(1);
    expect(native.methods.seek).toHaveBeenCalledWith(5_000);
    expect(native.methods.setRate).toHaveBeenCalledWith(0.7);
    expect(native.methods.stopAndSeek).toHaveBeenCalledWith(2_000);
    expect(native.methods.getPlaybackSnapshot).toHaveBeenCalledTimes(1);
    expect(native.methods.unload).toHaveBeenCalledTimes(1);
  });

  it('subscribes to the two typed native events', () => {
    const native = createNativeMock();
    const service = new NativeAudioService(native.dependency);
    const onProgress = jest.fn();
    const onPlayback = jest.fn();

    const progressSubscription = service.addImportProgressListener(onProgress);
    const playbackSubscription = service.addPlaybackChangedListener(onPlayback);

    expect(native.addListener).toHaveBeenNthCalledWith(1, 'onImportProgress', onProgress);
    expect(native.addListener).toHaveBeenNthCalledWith(2, 'onPlaybackChanged', onPlayback);
    expect(typeof progressSubscription.remove).toBe('function');
    expect(typeof playbackSubscription.remove).toBe('function');
  });

  it('maps a native method rejection to AppError', async () => {
    const native = createNativeMock();
    native.methods.loadAudio.mockRejectedValueOnce(
      Object.assign(new Error('URL no longer exists'), {
        code: 'E_FILE_NOT_FOUND',
      }),
    );
    const service = new NativeAudioService(native.dependency);

    await expect(service.loadAudio('file:///documents/missing.m4a')).rejects.toMatchObject({
      name: 'AppError',
      code: 'E_FILE_NOT_FOUND',
      userMessage: 'The project audio file is missing.',
      technicalMessage: 'URL no longer exists',
    } satisfies Partial<AppError>);
  });

  it('maps a synchronous listener failure to AppError', () => {
    const native = createNativeMock();
    native.dependency.addListener = () => {
      throw Object.assign(new Error('Native emitter unavailable'), {
        code: 'E_INTERNAL',
      });
    };
    const service = new NativeAudioService(native.dependency);

    expect(() => service.addPlaybackChangedListener(jest.fn())).toThrow(AppError);
  });
});

import type { NativePlaybackRate, PlaybackEvent, PlaybackSnapshot } from '../modules/dance-audio';
import { createPlaybackStore, type PlaybackNativeAudioDependency } from '@/stores/usePlaybackStore';
import { AppError } from '@/utils/errors';

const READY_SNAPSHOT: PlaybackSnapshot = {
  state: 'ready',
  currentTimeMs: 2_000,
  durationMs: 90_000,
  rate: 1,
  activeRangeStartMs: null,
  activeRangeEndMs: null,
};

const PLAYING_SNAPSHOT: PlaybackSnapshot = {
  state: 'playing',
  currentTimeMs: 4_000,
  durationMs: 90_000,
  rate: 0.8,
  activeRangeStartMs: 4_000,
  activeRangeEndMs: 12_000,
};

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise!: (value: Value) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function createNativePlaybackMock(): jest.Mocked<PlaybackNativeAudioDependency> {
  return {
    loadAudio: jest.fn<Promise<PlaybackSnapshot>, [audioUri: string]>(async () => READY_SNAPSHOT),
    playRange: jest.fn<
      Promise<PlaybackSnapshot>,
      [startMs: number, endMs: number, rate: NativePlaybackRate]
    >(async () => PLAYING_SNAPSHOT),
    playFrom: jest.fn<Promise<PlaybackSnapshot>, [positionMs: number, rate: NativePlaybackRate]>(
      async () => PLAYING_SNAPSHOT,
    ),
    pause: jest.fn<Promise<PlaybackSnapshot>, []>(async () => ({
      ...PLAYING_SNAPSHOT,
      state: 'paused',
    })),
    resume: jest.fn<Promise<PlaybackSnapshot>, []>(async () => PLAYING_SNAPSHOT),
    seek: jest.fn<Promise<PlaybackSnapshot>, [positionMs: number]>(async (positionMs) => ({
      ...READY_SNAPSHOT,
      currentTimeMs: positionMs,
    })),
    setRate: jest.fn<Promise<PlaybackSnapshot>, [rate: NativePlaybackRate]>(async (rate) => ({
      ...READY_SNAPSHOT,
      rate,
    })),
    stopAndSeek: jest.fn<Promise<PlaybackSnapshot>, [positionMs: number]>(async (positionMs) => ({
      ...READY_SNAPSHOT,
      currentTimeMs: positionMs,
    })),
    getPlaybackSnapshot: jest.fn<Promise<PlaybackSnapshot>, []>(async () => READY_SNAPSHOT),
    unload: jest.fn<Promise<void>, []>(async () => undefined),
  };
}

describe('playback store', () => {
  it('stores project, segment, and rate selection without resolving the native module', () => {
    const nativeAudio = createNativePlaybackMock();
    const store = createPlaybackStore(nativeAudio);

    store.getState().setSelection({
      projectId: 'project-1',
      segmentNumber: 3,
      rate: 0.8,
    });

    expect(store.getState()).toMatchObject({
      selectedProjectId: 'project-1',
      selectedSegment: 3,
      selectedRate: 0.8,
      snapshot: {
        state: 'idle',
        currentTimeMs: 0,
        rate: 0.8,
      },
    });
    expect(nativeAudio.loadAudio).not.toHaveBeenCalled();
  });

  it('uses a native event as the complete playback snapshot and playhead source', () => {
    const store = createPlaybackStore(createNativePlaybackMock());
    const event: PlaybackEvent = {
      ...PLAYING_SNAPSHOT,
      currentTimeMs: 6_400,
      reason: 'user',
    };

    store.getState().receiveNativeEvent(event);

    expect(store.getState().snapshot).toEqual({
      ...PLAYING_SNAPSHOT,
      currentTimeMs: 6_400,
    });
    expect(store.getState().lastEventReason).toBe('user');
  });

  it('ignores events from older native commands while accepting updates from the current one', () => {
    const store = createPlaybackStore(createNativePlaybackMock());

    store.getState().receiveNativeEvent({
      ...PLAYING_SNAPSHOT,
      commandGeneration: 12,
      currentTimeMs: 6_400,
      reason: 'user',
    });
    store.getState().receiveNativeEvent({
      ...READY_SNAPSHOT,
      commandGeneration: 11,
      currentTimeMs: 1_000,
      reason: 'error',
    });

    expect(store.getState().snapshot).toMatchObject({
      state: 'playing',
      currentTimeMs: 6_400,
    });
    expect(store.getState().lastEventReason).toBe('user');

    store.getState().receiveNativeEvent({
      ...PLAYING_SNAPSHOT,
      commandGeneration: 12,
      currentTimeMs: 6_500,
    });

    expect(store.getState().snapshot.currentTimeMs).toBe(6_500);
    expect(store.getState().lastEventReason).toBeNull();
  });

  it('tracks pending command IDs and uses a returned snapshot when no event arrived', async () => {
    const nativeAudio = createNativePlaybackMock();
    const pendingLoad = deferred<PlaybackSnapshot>();
    nativeAudio.loadAudio.mockReturnValueOnce(pendingLoad.promise);
    const store = createPlaybackStore(nativeAudio);

    const loadPromise = store
      .getState()
      .loadAudio('file:///documents/TempoLoop/Projects/one/audio.m4a');

    expect(store.getState().loadedAudioUri).toBeNull();
    expect(store.getState().command).toEqual({
      latestId: 1,
      pendingId: 1,
      kind: 'load-audio',
      status: 'pending',
    });

    pendingLoad.resolve(READY_SNAPSHOT);
    await expect(loadPromise).resolves.toEqual(READY_SNAPSHOT);

    expect(store.getState().snapshot).toEqual(READY_SNAPSHOT);
    expect(store.getState().loadedAudioUri).toBe(
      'file:///documents/TempoLoop/Projects/one/audio.m4a',
    );
    expect(store.getState().command).toEqual({
      latestId: 1,
      pendingId: null,
      kind: 'load-audio',
      status: 'succeeded',
    });
  });

  it('does not let a command result overwrite a newer native event', async () => {
    const nativeAudio = createNativePlaybackMock();
    const pendingPause = deferred<PlaybackSnapshot>();
    nativeAudio.pause.mockReturnValueOnce(pendingPause.promise);
    const store = createPlaybackStore(nativeAudio);
    const newestNativeEvent: PlaybackEvent = {
      ...PLAYING_SNAPSHOT,
      currentTimeMs: 7_300,
      reason: 'interruption',
      state: 'paused',
    };

    const pausePromise = store.getState().pause();
    store.getState().receiveNativeEvent(newestNativeEvent);
    pendingPause.resolve({
      ...PLAYING_SNAPSHOT,
      currentTimeMs: 7_000,
      state: 'paused',
    });
    await pausePromise;

    expect(store.getState().snapshot.currentTimeMs).toBe(7_300);
    expect(store.getState().lastEventReason).toBe('interruption');
  });

  it('does not count an ignored stale event as a command update', async () => {
    const nativeAudio = createNativePlaybackMock();
    const pendingPause = deferred<PlaybackSnapshot>();
    nativeAudio.pause.mockReturnValueOnce(pendingPause.promise);
    const store = createPlaybackStore(nativeAudio);

    store.getState().receiveNativeEvent({
      ...PLAYING_SNAPSHOT,
      commandGeneration: 10,
      currentTimeMs: 7_300,
    });

    const pausePromise = store.getState().pause();
    store.getState().receiveNativeEvent({
      ...PLAYING_SNAPSHOT,
      commandGeneration: 9,
      currentTimeMs: 4_200,
    });
    pendingPause.resolve({
      ...PLAYING_SNAPSHOT,
      currentTimeMs: 7_500,
      state: 'paused',
    });
    await pausePromise;

    expect(store.getState().snapshot).toMatchObject({
      state: 'paused',
      currentTimeMs: 7_500,
    });
  });

  it('ignores stale command completion after a newer command starts', async () => {
    const nativeAudio = createNativePlaybackMock();
    const firstPause = deferred<PlaybackSnapshot>();
    const laterResume = deferred<PlaybackSnapshot>();
    nativeAudio.pause.mockReturnValueOnce(firstPause.promise);
    nativeAudio.resume.mockReturnValueOnce(laterResume.promise);
    const store = createPlaybackStore(nativeAudio);

    const pausePromise = store.getState().pause();
    const resumePromise = store.getState().resume();

    expect(store.getState().command.pendingId).toBe(2);
    laterResume.resolve({
      ...PLAYING_SNAPSHOT,
      currentTimeMs: 8_000,
    });
    await resumePromise;
    firstPause.resolve({
      ...PLAYING_SNAPSHOT,
      currentTimeMs: 7_000,
      state: 'paused',
    });
    await pausePromise;

    expect(store.getState().snapshot).toMatchObject({
      state: 'playing',
      currentTimeMs: 8_000,
    });
    expect(store.getState().command).toMatchObject({
      latestId: 2,
      pendingId: null,
      kind: 'resume',
      status: 'succeeded',
    });
  });

  it('passes the selected rate to range playback and rate changes', async () => {
    const nativeAudio = createNativePlaybackMock();
    const store = createPlaybackStore(nativeAudio);
    store.getState().setSelectedRate(0.7);

    await store.getState().playRange(2_000, 12_000);
    await store.getState().setRate(0.9);

    expect(nativeAudio.playRange).toHaveBeenCalledWith(2_000, 12_000, 0.7);
    expect(nativeAudio.setRate).toHaveBeenCalledWith(0.9);
    expect(store.getState().selectedRate).toBe(0.9);
  });

  it('maps raw command failures and only exposes the latest failure', async () => {
    const nativeAudio = createNativePlaybackMock();
    nativeAudio.seek.mockRejectedValueOnce(
      Object.assign(new Error('Native seek failed'), {
        code: 'E_SEEK_FAILED',
      }),
    );
    const store = createPlaybackStore(nativeAudio);

    await expect(store.getState().seek(3_000)).rejects.toBeInstanceOf(AppError);

    expect(store.getState().command).toMatchObject({
      latestId: 1,
      pendingId: null,
      kind: 'seek',
      status: 'failed',
    });
    expect(store.getState().lastError).toMatchObject({
      code: 'E_SEEK_FAILED',
      technicalMessage: 'Native seek failed',
    });
  });

  it('clears playback selection after the current unload succeeds', async () => {
    const nativeAudio = createNativePlaybackMock();
    const store = createPlaybackStore(nativeAudio);
    store.getState().setSelection({
      projectId: 'project-1',
      segmentNumber: 4,
      rate: 0.8,
    });
    await store.getState().loadAudio('file:///documents/TempoLoop/Projects/project-1/audio.m4a');
    store.getState().receiveNativeEvent(PLAYING_SNAPSHOT);

    await store.getState().unload();

    expect(store.getState()).toMatchObject({
      loadedAudioUri: null,
      selectedProjectId: null,
      selectedSegment: null,
      snapshot: {
        state: 'idle',
        currentTimeMs: 0,
        durationMs: 0,
      },
    });
  });
});

import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type {
  NativePlaybackRate,
  PlaybackChangeReason,
  PlaybackEvent,
  PlaybackSnapshot,
} from '../../modules/dance-audio';
import type { PlaybackRate } from '@/domain/playback';
import type { SegmentNumber } from '@/domain/segment';
import { nativeAudioService } from '@/services/NativeAudioService';
import { type AppError, toAppError } from '@/utils/errors';

export type PlaybackCommandKind =
  | 'load-audio'
  | 'play-range'
  | 'play-from'
  | 'pause'
  | 'resume'
  | 'seek'
  | 'set-rate'
  | 'stop-and-seek'
  | 'refresh-snapshot'
  | 'unload';

export type PlaybackCommandStatus = 'idle' | 'pending' | 'succeeded' | 'failed';

export interface PlaybackCommandState {
  readonly latestId: number;
  readonly pendingId: number | null;
  readonly kind: PlaybackCommandKind | null;
  readonly status: PlaybackCommandStatus;
}

export interface PlaybackNativeAudioDependency {
  loadAudio(audioUri: string): Promise<PlaybackSnapshot>;
  playRange(startMs: number, endMs: number, rate: NativePlaybackRate): Promise<PlaybackSnapshot>;
  playFrom(positionMs: number, rate: NativePlaybackRate): Promise<PlaybackSnapshot>;
  pause(): Promise<PlaybackSnapshot>;
  resume(): Promise<PlaybackSnapshot>;
  seek(positionMs: number): Promise<PlaybackSnapshot>;
  setRate(rate: NativePlaybackRate): Promise<PlaybackSnapshot>;
  stopAndSeek(positionMs: number): Promise<PlaybackSnapshot>;
  getPlaybackSnapshot(): Promise<PlaybackSnapshot>;
  unload(): Promise<void>;
}

export interface PlaybackSelection {
  readonly projectId: string | null;
  readonly segmentNumber: SegmentNumber | null;
  readonly rate: PlaybackRate;
}

export interface PlaybackStoreState {
  readonly snapshot: PlaybackSnapshot;
  readonly lastEventReason: PlaybackChangeReason | null;
  readonly loadedAudioUri: string | null;
  readonly selectedProjectId: string | null;
  readonly selectedSegment: SegmentNumber | null;
  readonly selectedRate: PlaybackRate;
  readonly command: PlaybackCommandState;
  readonly lastError: AppError | null;

  setSelection(selection: PlaybackSelection): void;
  setSelectedSegment(segmentNumber: SegmentNumber | null): void;
  setSelectedRate(rate: PlaybackRate): void;
  receiveNativeEvent(event: PlaybackEvent): void;
  recordError(error: unknown): void;
  clearError(): void;

  loadAudio(audioUri: string): Promise<PlaybackSnapshot>;
  playRange(startMs: number, endMs: number, rate?: PlaybackRate): Promise<PlaybackSnapshot>;
  playFrom(positionMs: number, rate?: PlaybackRate): Promise<PlaybackSnapshot>;
  pause(): Promise<PlaybackSnapshot>;
  resume(): Promise<PlaybackSnapshot>;
  seek(positionMs: number): Promise<PlaybackSnapshot>;
  setRate(rate: PlaybackRate): Promise<PlaybackSnapshot>;
  stopAndSeek(positionMs: number): Promise<PlaybackSnapshot>;
  refreshSnapshot(): Promise<PlaybackSnapshot>;
  unload(): Promise<void>;
}

export type PlaybackStore = UseBoundStore<StoreApi<PlaybackStoreState>>;

function createInitialSnapshot(rate: PlaybackRate = 1): PlaybackSnapshot {
  return {
    state: 'idle',
    currentTimeMs: 0,
    durationMs: 0,
    rate,
    activeRangeStartMs: null,
    activeRangeEndMs: null,
  };
}

function createInitialCommandState(): PlaybackCommandState {
  return {
    latestId: 0,
    pendingId: null,
    kind: null,
    status: 'idle',
  };
}

function snapshotFromEvent(event: PlaybackEvent): PlaybackSnapshot {
  return {
    state: event.state,
    currentTimeMs: event.currentTimeMs,
    durationMs: event.durationMs,
    rate: event.rate,
    activeRangeStartMs: event.activeRangeStartMs,
    activeRangeEndMs: event.activeRangeEndMs,
  };
}

/**
 * Creates an isolated playback store around an injected native dependency.
 *
 * Production exports one instance below. Tests can create independent stores
 * without resolving the required DanceAudio native module.
 */
export function createPlaybackStore(
  nativeAudio: PlaybackNativeAudioDependency = nativeAudioService,
): PlaybackStore {
  let nextCommandId = 0;
  let nativeEventVersion = 0;
  let acceptedNativeGeneration: number | null = null;

  return create<PlaybackStoreState>()((set, get) => {
    async function runCommand<Result>(
      kind: PlaybackCommandKind,
      operation: () => Promise<Result>,
      onCurrentSuccess?: (
        result: Result,
        state: PlaybackStoreState,
        nativeEventArrived: boolean,
      ) => Partial<PlaybackStoreState>,
    ): Promise<Result> {
      const commandId = ++nextCommandId;
      const eventVersionAtStart = nativeEventVersion;

      set({
        command: {
          latestId: commandId,
          pendingId: commandId,
          kind,
          status: 'pending',
        },
        lastError: null,
      });

      try {
        const result = await operation();

        if (get().command.pendingId === commandId) {
          set((state) => ({
            ...onCurrentSuccess?.(result, state, nativeEventVersion !== eventVersionAtStart),
            command: {
              latestId: commandId,
              pendingId: null,
              kind,
              status: 'succeeded',
            },
          }));
        }

        return result;
      } catch (error) {
        const appError = toAppError(error);

        if (get().command.pendingId === commandId) {
          set({
            command: {
              latestId: commandId,
              pendingId: null,
              kind,
              status: 'failed',
            },
            lastError: appError,
          });
        }

        throw appError;
      }
    }

    function runSnapshotCommand(
      kind: PlaybackCommandKind,
      operation: () => Promise<PlaybackSnapshot>,
    ): Promise<PlaybackSnapshot> {
      return runCommand(kind, operation, (snapshot, state, nativeEventArrived) => ({
        snapshot: nativeEventArrived ? state.snapshot : snapshot,
      }));
    }

    return {
      snapshot: createInitialSnapshot(),
      lastEventReason: null,
      loadedAudioUri: null,
      selectedProjectId: null,
      selectedSegment: null,
      selectedRate: 1,
      command: createInitialCommandState(),
      lastError: null,

      setSelection: ({ projectId, segmentNumber, rate }) => {
        set((state) => {
          const projectChanged = state.selectedProjectId !== projectId;

          return {
            selectedProjectId: projectId,
            selectedSegment: segmentNumber,
            selectedRate: rate,
            ...(projectChanged
              ? {
                  snapshot: createInitialSnapshot(rate),
                  lastEventReason: null,
                  loadedAudioUri: null,
                }
              : {}),
          };
        });
      },

      setSelectedSegment: (segmentNumber) => {
        set({ selectedSegment: segmentNumber });
      },

      setSelectedRate: (rate) => {
        set({ selectedRate: rate });
      },

      receiveNativeEvent: (event) => {
        const eventGeneration = event.commandGeneration;
        // Production events are versioned. Unversioned injected/legacy mocks
        // remain usable, but a present generation must be valid and current.
        if (eventGeneration !== undefined) {
          if (!Number.isSafeInteger(eventGeneration) || eventGeneration < 0) {
            return;
          }
          if (acceptedNativeGeneration !== null && eventGeneration < acceptedNativeGeneration) {
            return;
          }
          acceptedNativeGeneration = eventGeneration;
        }

        // Only an accepted event may suppress a pending command's returned
        // snapshot fallback.
        nativeEventVersion += 1;
        set({
          snapshot: snapshotFromEvent(event),
          lastEventReason: event.reason ?? null,
        });
      },

      recordError: (error) => {
        set({ lastError: toAppError(error) });
      },

      clearError: () => {
        set({ lastError: null });
      },

      loadAudio: (audioUri) => {
        set({ loadedAudioUri: null });
        return runCommand(
          'load-audio',
          () => nativeAudio.loadAudio(audioUri),
          (snapshot, state, nativeEventArrived) => ({
            snapshot: nativeEventArrived ? state.snapshot : snapshot,
            loadedAudioUri: audioUri,
          }),
        );
      },

      playRange: (startMs, endMs, rate = get().selectedRate) =>
        runSnapshotCommand('play-range', () => nativeAudio.playRange(startMs, endMs, rate)),

      playFrom: (positionMs, rate = get().selectedRate) =>
        runSnapshotCommand('play-from', () => nativeAudio.playFrom(positionMs, rate)),

      pause: () => runSnapshotCommand('pause', () => nativeAudio.pause()),

      resume: () => runSnapshotCommand('resume', () => nativeAudio.resume()),

      seek: (positionMs) => runSnapshotCommand('seek', () => nativeAudio.seek(positionMs)),

      setRate: (rate) => {
        set({ selectedRate: rate });
        return runSnapshotCommand('set-rate', () => nativeAudio.setRate(rate));
      },

      stopAndSeek: (positionMs) =>
        runSnapshotCommand('stop-and-seek', () => nativeAudio.stopAndSeek(positionMs)),

      refreshSnapshot: () =>
        runSnapshotCommand('refresh-snapshot', () => nativeAudio.getPlaybackSnapshot()),

      unload: () =>
        runCommand(
          'unload',
          () => nativeAudio.unload(),
          (_result, state, eventArrived) => ({
            snapshot: eventArrived ? state.snapshot : createInitialSnapshot(),
            lastEventReason: null,
            loadedAudioUri: null,
            selectedProjectId: null,
            selectedSegment: null,
          }),
        ),
    };
  });
}

export const usePlaybackStore = createPlaybackStore();

import {
  LEAD_IN_OPTIONS_MS,
  PLAYBACK_RATES,
  type PlaybackMode,
  type PlaybackRate,
  type PlaybackSnapshot,
  isPlaybackRate,
} from '@/domain/playback';
import {
  PRACTICE_POST_ROLL_MS,
  SegmentEndGuard,
  type SegmentEndGuardScheduler,
} from '@/playback/SegmentEndGuard';
import {
  type StructuredDiagnosticsRecorder,
  structuredDevelopmentDiagnostics,
} from '@/services/StructuredDevelopmentDiagnostics';

const LOAD_TIMEOUT_MS = 15_000;
const DURATION_TOLERANCE_MS = 1_000;

export interface TempoLoopAudioStatus {
  readonly currentTime: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly didJustFinish: boolean;
  readonly isLoaded: boolean;
  readonly isBuffering: boolean;
  readonly playbackRate: number;
  readonly error: string | null;
}

export interface TempoLoopPlayerPort {
  pause(): void;
  play(): void;
  replace(sourceUri: string | null): void;
  seekTo(positionSeconds: number): Promise<void>;
  setRate(rate: PlaybackRate): void;
}

export interface PlaybackCoordinatorScheduler extends SegmentEndGuardScheduler {
  now(): number;
}

export interface PlaybackProjectInput {
  readonly projectId: string;
  readonly audioUri: string;
  readonly durationMs: number;
}

export interface PracticeSegmentInput {
  readonly segmentIndex: number;
  readonly clipStartMs: number;
  readonly clipEndMs: number;
  readonly countdownMs: number;
  readonly rate: PlaybackRate;
}

interface StatusWaiter {
  readonly commandGeneration: number;
  readonly minimumSequence: number;
  readonly predicate: (status: TempoLoopAudioStatus) => boolean;
  readonly resolve: (matched: boolean) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

const defaultScheduler: PlaybackCoordinatorScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

const MAX_COUNTDOWN_MS = LEAD_IN_OPTIONS_MS.at(-1) ?? 0;

const INITIAL_SNAPSHOT: PlaybackSnapshot = {
  mode: 'idle',
  status: 'idle',
  projectId: null,
  segmentIndex: null,
  sourcePositionMs: 0,
  sourceDurationMs: 0,
  clipStartMs: 0,
  clipEndMs: null,
  rate: 1,
  countdownRemainingSeconds: null,
  commandGeneration: 0,
};

function secondsToMilliseconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : 0;
}

function clampIntegerMs(value: number, durationMs: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(Math.round(value), 0), Math.max(0, Math.round(durationMs)));
}

function loadedDurationMatches(status: TempoLoopAudioStatus, expectedDurationMs: number): boolean {
  const nativeDurationMs = secondsToMilliseconds(status.duration);
  return (
    status.isLoaded &&
    status.error === null &&
    nativeDurationMs > 0 &&
    Math.abs(nativeDurationMs - expectedDurationMs) <= DURATION_TOLERANCE_MS
  );
}

/**
 * Serializes all player mutations. Native status remains the source of truth,
 * while command generations prevent stale seeks from changing playback state.
 */
export class PlaybackCoordinator {
  private snapshot: PlaybackSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private readonly statusWaiters = new Set<StatusWaiter>();
  private readonly endGuard: SegmentEndGuard;
  private currentSourceUri: string | null = null;
  private currentProjectId: string | null = null;
  private latestNativeStatus: TempoLoopAudioStatus | null = null;
  private statusSequence = 0;
  private nativeWasPlaying = false;
  private playbackAuthorized = false;
  private audioFailureGeneration: number | null = null;
  private practiceCountdownMs = 0;
  private countdownDeadlineMs: number | null = null;
  private countdownGeneration: number | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly player: TempoLoopPlayerPort,
    private readonly scheduler: PlaybackCoordinatorScheduler = defaultScheduler,
    private readonly diagnostics: Pick<
      StructuredDiagnosticsRecorder,
      'recordAudioLoadFailure' | 'recordStalePlaybackCommand' | 'recordSegmentEndOvershoot'
    > = structuredDevelopmentDiagnostics,
  ) {
    this.endGuard = new SegmentEndGuard(scheduler);
  }

  getSnapshot = (): PlaybackSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getCurrentPositionMs(): number {
    return this.snapshot.sourcePositionMs;
  }

  getActiveSourceUri(): string | null {
    return this.currentSourceUri;
  }

  async enterEditor(input: PlaybackProjectInput): Promise<boolean> {
    return this.enterMode('editor', input, 1);
  }

  async enterPractice(input: PlaybackProjectInput, rate: PlaybackRate): Promise<boolean> {
    return this.enterMode('practice', input, rate);
  }

  async preparePracticeSegment(input: PracticeSegmentInput): Promise<boolean> {
    this.assertUsable();
    if (
      this.snapshot.mode !== 'practice' ||
      this.snapshot.projectId === null ||
      !Number.isInteger(input.segmentIndex) ||
      input.segmentIndex < 0 ||
      !Number.isInteger(input.clipStartMs) ||
      !Number.isInteger(input.clipEndMs) ||
      !Number.isInteger(input.countdownMs) ||
      input.clipStartMs < 0 ||
      input.clipStartMs >= input.clipEndMs ||
      input.clipEndMs > this.snapshot.sourceDurationMs ||
      input.countdownMs < 0 ||
      input.countdownMs > MAX_COUNTDOWN_MS ||
      !isPlaybackRate(input.rate)
    ) {
      throw new Error('E_PLAYBACK_INVALID_RANGE');
    }

    const generation = this.nextGeneration();
    this.player.pause();
    this.player.setRate(input.rate);
    this.nativeWasPlaying = false;
    this.playbackAuthorized = false;
    this.practiceCountdownMs = input.countdownMs;
    this.patchSnapshot({
      status: 'loading',
      segmentIndex: input.segmentIndex,
      clipStartMs: input.clipStartMs,
      clipEndMs: input.clipEndMs,
      rate: input.rate,
      countdownRemainingSeconds: null,
    });

    const seekCompleted = await this.guardedSeek(input.clipStartMs, generation);
    if (!seekCompleted) {
      return false;
    }

    this.patchSnapshot({ sourcePositionMs: input.clipStartMs, status: 'ready' });
    return true;
  }

  async togglePractice(): Promise<boolean> {
    this.assertUsable();
    const snapshot = this.snapshot;
    if (
      snapshot.mode !== 'practice' ||
      snapshot.projectId === null ||
      snapshot.segmentIndex === null ||
      snapshot.clipEndMs === null
    ) {
      return false;
    }

    if (snapshot.status === 'playing') {
      this.pause();
      return true;
    }

    if (snapshot.status === 'countdown') {
      this.nextGeneration();
      this.player.pause();
      this.nativeWasPlaying = false;
      this.playbackAuthorized = false;
      this.patchSnapshot({ status: 'ready', countdownRemainingSeconds: null });
      return true;
    }

    if (
      snapshot.status !== 'ready' &&
      snapshot.status !== 'paused' &&
      snapshot.status !== 'ended'
    ) {
      return false;
    }

    const generation = this.nextGeneration();
    this.player.pause();
    const seekCompleted = await this.guardedSeek(snapshot.clipStartMs, generation);
    if (!seekCompleted) {
      return false;
    }
    this.patchSnapshot({ sourcePositionMs: snapshot.clipStartMs });

    if (!this.isCurrent(generation)) {
      return false;
    }

    if (this.practiceCountdownMs > 0) {
      this.beginPracticeCountdown(generation);
      return true;
    }

    this.startPracticePlayback(generation);
    return true;
  }

  async playEditor(): Promise<boolean> {
    this.assertUsable();
    const snapshot = this.snapshot;
    if (
      snapshot.mode !== 'editor' ||
      (snapshot.status !== 'ready' && snapshot.status !== 'paused' && snapshot.status !== 'ended')
    ) {
      return false;
    }

    const generation = this.nextGeneration();
    if (snapshot.status === 'ended' || snapshot.sourcePositionMs >= snapshot.sourceDurationMs) {
      const seekCompleted = await this.guardedSeek(0, generation);
      if (!seekCompleted) {
        return false;
      }
      this.patchSnapshot({ sourcePositionMs: 0 });
    }

    if (!this.isCurrent(generation)) {
      return false;
    }
    this.player.setRate(1);
    this.playbackAuthorized = true;
    this.player.play();
    this.patchSnapshot({ rate: 1, status: 'playing' });
    return true;
  }

  pause(): void {
    this.assertUsable();
    const snapshot = this.snapshot;
    if (snapshot.status === 'idle' || snapshot.status === 'error') {
      return;
    }

    this.nextGeneration();
    this.player.pause();
    this.nativeWasPlaying = false;
    this.playbackAuthorized = false;
    this.patchSnapshot({ status: this.latestNativeStatus?.isLoaded === true ? 'paused' : 'idle' });
  }

  async seekEditor(positionMs: number, resumeAfterSeek = false): Promise<boolean> {
    this.assertUsable();
    const snapshot = this.snapshot;
    if (snapshot.mode !== 'editor' || snapshot.projectId === null) {
      return false;
    }

    const targetMs = clampIntegerMs(positionMs, snapshot.sourceDurationMs);
    const generation = this.nextGeneration();
    this.player.pause();
    this.nativeWasPlaying = false;
    this.playbackAuthorized = false;
    const seekCompleted = await this.guardedSeek(targetMs, generation);
    if (!seekCompleted) {
      return false;
    }

    this.patchSnapshot({ sourcePositionMs: targetMs, status: 'paused' });
    if (resumeAfterSeek && this.isCurrent(generation)) {
      this.playbackAuthorized = true;
      this.player.play();
      this.patchSnapshot({ status: 'playing' });
    }
    return true;
  }

  setRate(rate: PlaybackRate): boolean {
    this.assertUsable();
    if (!isPlaybackRate(rate) || this.snapshot.mode === 'editor') {
      return false;
    }

    const wasPlaying = this.snapshot.status === 'playing';
    const wasCountingDown = this.snapshot.status === 'countdown';
    const preserveEndGuard =
      wasPlaying && this.endGuard.isArmedFor(this.snapshot.commandGeneration);
    const generation = this.nextGeneration({
      preserveCountdown: wasCountingDown,
      preserveEndGuard,
    });
    this.player.setRate(rate);
    this.patchSnapshot({ rate });
    if (wasCountingDown) {
      this.countdownGeneration = generation;
    } else if (wasPlaying) {
      const updated =
        preserveEndGuard &&
        this.endGuard.updateRate({
          commandGeneration: generation,
          sourcePositionMs: this.snapshot.sourcePositionMs,
          rate,
        });
      if (!updated) {
        this.armPracticeEndGuard(generation);
      }
    }
    return true;
  }

  deactivate(): void {
    this.assertUsable();
    this.nextGeneration();
    this.player.pause();
    this.nativeWasPlaying = false;
    this.playbackAuthorized = false;
    this.patchSnapshot({
      mode: 'idle',
      status: 'idle',
      projectId: null,
      segmentIndex: null,
      clipStartMs: 0,
      clipEndMs: null,
      rate: 1,
      countdownRemainingSeconds: null,
    });
    this.practiceCountdownMs = 0;
  }

  clearSource(projectId?: string): boolean {
    this.assertUsable();
    if (
      projectId !== undefined &&
      this.currentProjectId !== null &&
      this.currentProjectId !== projectId
    ) {
      return false;
    }

    this.nextGeneration();
    // An idle coordinator has no Project source to release. Some Android
    // devices reject replace(null) when the native player is already empty,
    // so only touch Media3 when this coordinator owns an actual source.
    if (this.currentSourceUri !== null) {
      this.player.pause();
      this.player.replace(null);
    }
    this.currentSourceUri = null;
    this.currentProjectId = null;
    this.latestNativeStatus = null;
    this.nativeWasPlaying = false;
    this.playbackAuthorized = false;
    this.replaceSnapshot(INITIAL_SNAPSHOT, this.snapshot.commandGeneration);
    return true;
  }

  handleNativeStatus(status: TempoLoopAudioStatus): void {
    if (this.disposed) {
      return;
    }

    this.statusSequence += 1;
    this.latestNativeStatus = status;
    this.resolveStatusWaiters(status);

    if (status.error !== null) {
      this.endGuard.clear();
      this.clearCountdown();
      this.nativeWasPlaying = false;
      this.playbackAuthorized = false;
      for (const waiter of [...this.statusWaiters]) {
        this.finishWaiter(waiter, false);
      }
      this.patchSnapshot({ status: 'error', countdownRemainingSeconds: null });
      this.recordAudioLoadFailure();
      return;
    }

    const sourcePositionMs = clampIntegerMs(
      secondsToMilliseconds(status.currentTime),
      Math.max(this.snapshot.sourceDurationMs, secondsToMilliseconds(status.duration)),
    );
    const reportedDurationMs = secondsToMilliseconds(status.duration);
    const sourceDurationMs =
      status.isLoaded && reportedDurationMs > 0
        ? reportedDurationMs
        : this.snapshot.sourceDurationMs;
    this.patchSnapshot({ sourceDurationMs, sourcePositionMs });

    if (this.snapshot.mode === 'practice' && this.snapshot.clipEndMs !== null) {
      const observationGeneration = this.snapshot.commandGeneration;
      if (status.didJustFinish && this.snapshot.status === 'playing') {
        void this.finishPracticeRange(observationGeneration, 0);
        return;
      }
      this.endGuard.observe({
        commandGeneration: observationGeneration,
        sourcePositionMs,
        playing: status.playing,
      });
    } else if (status.didJustFinish && this.snapshot.mode === 'editor') {
      this.nativeWasPlaying = false;
      this.patchSnapshot({ status: 'ended' });
      return;
    }

    if (status.playing) {
      // expo-audio may resume Android playback after a focus gain or when the
      // Activity returns to the foreground. TempoLoop only permits playback
      // after an explicit user command, so reject every unsolicited restart.
      if (!this.playbackAuthorized) {
        this.endGuard.clear();
        this.player.pause();
        this.nativeWasPlaying = false;
        if (this.snapshot.status === 'playing') {
          this.patchSnapshot({ status: 'paused' });
        }
        return;
      }
      this.nativeWasPlaying = true;
      if (this.snapshot.status !== 'loading') {
        this.patchSnapshot({ status: 'playing' });
      }
      return;
    }

    if (this.nativeWasPlaying && this.snapshot.status === 'playing') {
      this.endGuard.clear();
      this.nativeWasPlaying = false;
      this.playbackAuthorized = false;
      this.patchSnapshot({ status: 'paused' });
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.nextGeneration();
    this.player.pause();
    this.endGuard.clear();
    this.playbackAuthorized = false;
    this.currentSourceUri = null;
    this.currentProjectId = null;
    this.practiceCountdownMs = 0;
    this.listeners.clear();
    this.disposed = true;
  }

  private async enterMode(
    mode: Exclude<PlaybackMode, 'idle'>,
    input: PlaybackProjectInput,
    rate: PlaybackRate,
  ): Promise<boolean> {
    this.assertUsable();
    if (
      input.projectId.length === 0 ||
      !input.audioUri.startsWith('file://') ||
      !Number.isInteger(input.durationMs) ||
      input.durationMs <= 0 ||
      !PLAYBACK_RATES.includes(rate)
    ) {
      throw new Error('E_PLAYBACK_INVALID_SOURCE');
    }

    const generation = this.nextGeneration();
    this.player.pause();
    this.player.setRate(mode === 'editor' ? 1 : rate);
    this.nativeWasPlaying = false;
    this.playbackAuthorized = false;
    const canReuseSource =
      this.currentProjectId === input.projectId &&
      this.currentSourceUri === input.audioUri &&
      this.latestNativeStatus?.isLoaded === true;

    this.patchSnapshot({
      mode,
      status: canReuseSource ? 'ready' : 'loading',
      projectId: input.projectId,
      segmentIndex: null,
      sourcePositionMs: canReuseSource
        ? clampIntegerMs(
            secondsToMilliseconds(this.latestNativeStatus?.currentTime ?? 0),
            input.durationMs,
          )
        : 0,
      sourceDurationMs: input.durationMs,
      clipStartMs: 0,
      clipEndMs: null,
      rate: mode === 'editor' ? 1 : rate,
      countdownRemainingSeconds: null,
    });

    if (canReuseSource) {
      return true;
    }

    this.currentSourceUri = input.audioUri;
    this.currentProjectId = input.projectId;
    this.latestNativeStatus = null;
    try {
      this.player.replace(input.audioUri);
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.patchSnapshot({ status: 'error' });
      }
      this.recordAudioLoadFailure();
      throw error;
    }

    const matched = await this.waitForStatus(
      generation,
      (status) => loadedDurationMatches(status, input.durationMs),
      LOAD_TIMEOUT_MS,
    );
    if (!matched) {
      if (this.isCurrent(generation)) {
        this.recordAudioLoadFailure();
      } else {
        this.recordStaleCommand('loadAudio', generation);
      }
      return false;
    }
    if (!this.isCurrent(generation)) {
      this.recordStaleCommand('loadAudio', generation);
      return false;
    }

    const loadedStatus = this.latestNativeStatus as TempoLoopAudioStatus | null;
    this.patchSnapshot({
      sourceDurationMs: secondsToMilliseconds(loadedStatus?.duration ?? 0),
      sourcePositionMs: secondsToMilliseconds(loadedStatus?.currentTime ?? 0),
      status: 'ready',
    });
    return true;
  }

  private async guardedSeek(positionMs: number, generation: number): Promise<boolean> {
    try {
      await this.player.seekTo(positionMs / 1_000);
    } catch (error) {
      if (!this.isCurrent(generation)) {
        this.recordStaleCommand('seek', generation);
        return false;
      }
      this.patchSnapshot({ status: 'error' });
      throw error;
    }
    const current = this.isCurrent(generation);
    if (!current) {
      this.recordStaleCommand('seek', generation);
    }
    return current;
  }

  private beginPracticeCountdown(generation: number): void {
    if (!this.isCurrent(generation) || this.practiceCountdownMs <= 0) {
      this.startPracticePlayback(generation);
      return;
    }

    this.clearCountdown();
    this.player.pause();
    this.nativeWasPlaying = false;
    this.playbackAuthorized = false;
    this.countdownDeadlineMs = this.scheduler.now() + this.practiceCountdownMs;
    this.countdownGeneration = generation;
    this.patchSnapshot({ status: 'countdown' });
    this.scheduleCountdownTick();
  }

  private scheduleCountdownTick(): void {
    const deadlineMs = this.countdownDeadlineMs;
    const generation = this.countdownGeneration;
    if (deadlineMs === null || generation === null) {
      return;
    }

    const remainingMs = Math.max(0, deadlineMs - this.scheduler.now());
    if (remainingMs === 0) {
      this.clearCountdown();
      if (this.isCurrent(generation) && this.snapshot.status === 'countdown') {
        this.startPracticePlayback(generation);
      }
      return;
    }

    const remainingSeconds = Math.ceil(remainingMs / 1_000);
    if (this.snapshot.countdownRemainingSeconds !== remainingSeconds) {
      this.patchSnapshot({ countdownRemainingSeconds: remainingSeconds });
    }

    const nextBoundaryDelayMs = Math.max(1, remainingMs - (remainingSeconds - 1) * 1_000);
    this.countdownTimer = this.scheduler.setTimeout(
      () => this.scheduleCountdownTick(),
      nextBoundaryDelayMs,
    );
  }

  private startPracticePlayback(generation: number): void {
    const snapshot = this.snapshot;
    if (
      !this.isCurrent(generation) ||
      snapshot.mode !== 'practice' ||
      snapshot.segmentIndex === null ||
      snapshot.clipEndMs === null
    ) {
      return;
    }

    this.clearCountdown();
    this.player.setRate(snapshot.rate);
    this.playbackAuthorized = true;
    this.player.play();
    this.patchSnapshot({ status: 'playing', countdownRemainingSeconds: null });
    this.armPracticeEndGuard(generation);
  }

  private clearCountdown(): void {
    if (this.countdownTimer !== null) {
      this.scheduler.clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownDeadlineMs = null;
    this.countdownGeneration = null;
  }

  private armPracticeEndGuard(generation: number): void {
    const snapshot = this.snapshot;
    if (
      snapshot.mode !== 'practice' ||
      snapshot.clipEndMs === null ||
      snapshot.status !== 'playing' ||
      !this.isCurrent(generation)
    ) {
      return;
    }

    this.endGuard.arm({
      commandGeneration: generation,
      sourcePositionMs: snapshot.sourcePositionMs,
      clipEndMs: snapshot.clipEndMs,
      rate: snapshot.rate,
      postRollMs: PRACTICE_POST_ROLL_MS,
      onEnd: ({ commandGeneration, postRollOvershootMs }) => {
        void this.finishPracticeRange(commandGeneration, postRollOvershootMs);
      },
    });
  }

  private async finishPracticeRange(
    guardGeneration: number,
    postRollOvershootMs: number,
  ): Promise<void> {
    if (
      !this.isCurrent(guardGeneration) ||
      this.snapshot.mode !== 'practice' ||
      this.snapshot.projectId === null ||
      this.snapshot.clipEndMs === null
    ) {
      if (!this.isCurrent(guardGeneration)) {
        this.recordStaleCommand('finishPracticeRange', guardGeneration);
      }
      return;
    }

    this.diagnostics.recordSegmentEndOvershoot({
      projectId: this.snapshot.projectId,
      segmentIndex: this.snapshot.segmentIndex ?? 0,
      commandGeneration: guardGeneration,
      rate: this.snapshot.rate,
      overshootMs: postRollOvershootMs,
    });
    const resetPositionMs = this.snapshot.clipStartMs;
    const generation = this.nextGeneration();
    this.player.pause();
    this.nativeWasPlaying = false;
    this.playbackAuthorized = false;
    this.patchSnapshot({ status: 'loading', countdownRemainingSeconds: null });
    const seekCompleted = await this.guardedSeek(resetPositionMs, generation);
    if (seekCompleted) {
      this.patchSnapshot({ sourcePositionMs: resetPositionMs, status: 'ready' });
    }
  }

  private waitForStatus(
    commandGeneration: number,
    predicate: (status: TempoLoopAudioStatus) => boolean,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let waiter: StatusWaiter;
      waiter = {
        commandGeneration,
        minimumSequence: this.statusSequence + 1,
        predicate,
        resolve,
        timeout: this.scheduler.setTimeout(() => {
          this.statusWaiters.delete(waiter);
          if (this.isCurrent(commandGeneration)) {
            this.patchSnapshot({ status: 'error' });
          }
          resolve(false);
        }, timeoutMs),
      };
      this.statusWaiters.add(waiter);
    });
  }

  private resolveStatusWaiters(status: TempoLoopAudioStatus): void {
    for (const waiter of [...this.statusWaiters]) {
      if (!this.isCurrent(waiter.commandGeneration)) {
        this.finishWaiter(waiter, false);
      } else if (this.statusSequence >= waiter.minimumSequence && waiter.predicate(status)) {
        this.finishWaiter(waiter, true);
      }
    }
  }

  private finishWaiter(waiter: StatusWaiter, matched: boolean): void {
    this.statusWaiters.delete(waiter);
    this.scheduler.clearTimeout(waiter.timeout);
    waiter.resolve(matched);
  }

  private nextGeneration(
    options: { readonly preserveCountdown?: boolean; readonly preserveEndGuard?: boolean } = {},
  ): number {
    const generation = this.snapshot.commandGeneration + 1;
    if (options.preserveEndGuard !== true) {
      this.endGuard.clear();
    }
    if (options.preserveCountdown !== true) {
      this.clearCountdown();
    }
    for (const waiter of [...this.statusWaiters]) {
      this.finishWaiter(waiter, false);
    }
    this.patchSnapshot({
      commandGeneration: generation,
      ...(options.preserveCountdown === true ? {} : { countdownRemainingSeconds: null }),
    });
    return generation;
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.snapshot.commandGeneration === generation;
  }

  private recordAudioLoadFailure(): void {
    const generation = this.snapshot.commandGeneration;
    if (this.audioFailureGeneration === generation) {
      return;
    }
    this.audioFailureGeneration = generation;
    this.diagnostics.recordAudioLoadFailure({
      projectId: this.currentProjectId ?? undefined,
      error: { code: 'E_AUDIO_LOAD_FAILED' },
    });
  }

  private recordStaleCommand(command: string, generation: number): void {
    this.diagnostics.recordStalePlaybackCommand({
      command,
      commandGeneration: generation,
      currentGeneration: this.snapshot.commandGeneration,
    });
  }

  private patchSnapshot(patch: Partial<PlaybackSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    if (Object.is(next, this.snapshot)) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private replaceSnapshot(snapshot: PlaybackSnapshot, commandGeneration: number): void {
    this.snapshot = { ...snapshot, commandGeneration };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error('E_PLAYBACK_DISPOSED');
    }
  }
}

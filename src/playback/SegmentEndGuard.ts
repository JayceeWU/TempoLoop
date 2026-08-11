export const END_GUARD_MS = 30;
export const END_DEADLINE_SLACK_MS = 20;
export const PRACTICE_POST_ROLL_MS = 2_000;

export interface SegmentEndGuardScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export interface SegmentEndGuardCompletion {
  readonly commandGeneration: number;
  readonly postRollOvershootMs: number;
}

export interface SegmentEndGuardArm {
  readonly commandGeneration: number;
  readonly sourcePositionMs: number;
  readonly clipEndMs: number;
  readonly rate: number;
  readonly postRollMs: number;
  readonly onEnd: (completion: SegmentEndGuardCompletion) => void;
}

export interface SegmentEndGuardObservation {
  readonly commandGeneration: number;
  readonly sourcePositionMs: number;
  readonly playing: boolean;
}

export interface SegmentEndGuardRateUpdate {
  readonly commandGeneration: number;
  readonly sourcePositionMs: number;
  readonly rate: number;
}

type GuardPhase = 'approaching-end' | 'post-roll';

interface ActiveGuard extends SegmentEndGuardArm {
  commandGeneration: number;
  sourcePositionMs: number;
  rate: number;
  phase: GuardPhase;
  postRollStartedAtMs: number | null;
  triggered: boolean;
}

const defaultScheduler: SegmentEndGuardScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Watches the source-time segment marker, then keeps playback alive for one
 * wall-clock post-roll. Both phases use the native status stream plus one
 * deadline and never create a polling interval.
 */
export class SegmentEndGuard {
  private active: ActiveGuard | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly scheduler: SegmentEndGuardScheduler = defaultScheduler) {}

  arm(input: SegmentEndGuardArm): void {
    this.clear();

    if (
      !Number.isInteger(input.commandGeneration) ||
      input.commandGeneration < 0 ||
      !isFiniteNonNegative(input.sourcePositionMs) ||
      !isFiniteNonNegative(input.clipEndMs) ||
      input.clipEndMs < input.sourcePositionMs ||
      !Number.isFinite(input.rate) ||
      input.rate <= 0 ||
      !Number.isInteger(input.postRollMs) ||
      input.postRollMs < 0
    ) {
      return;
    }

    this.active = {
      ...input,
      commandGeneration: input.commandGeneration,
      sourcePositionMs: input.sourcePositionMs,
      rate: input.rate,
      phase: 'approaching-end',
      postRollStartedAtMs: null,
      triggered: false,
    };
    this.scheduleMarkerDeadline(END_DEADLINE_SLACK_MS);
  }

  observe(observation: SegmentEndGuardObservation): boolean {
    const active = this.active;
    if (
      active === null ||
      active.triggered ||
      !observation.playing ||
      observation.commandGeneration !== active.commandGeneration ||
      !isFiniteNonNegative(observation.sourcePositionMs)
    ) {
      return false;
    }

    active.sourcePositionMs = observation.sourcePositionMs;
    if (
      active.phase === 'post-roll' ||
      observation.sourcePositionMs < active.clipEndMs - END_GUARD_MS
    ) {
      return false;
    }

    if (observation.sourcePositionMs >= active.clipEndMs) {
      this.beginPostRoll();
    } else {
      this.scheduleMarkerDeadline(0);
    }
    return true;
  }

  updateRate(input: SegmentEndGuardRateUpdate): boolean {
    const active = this.active;
    if (
      active === null ||
      active.triggered ||
      !Number.isInteger(input.commandGeneration) ||
      input.commandGeneration < 0 ||
      !isFiniteNonNegative(input.sourcePositionMs) ||
      !Number.isFinite(input.rate) ||
      input.rate <= 0
    ) {
      return false;
    }

    active.commandGeneration = input.commandGeneration;
    active.sourcePositionMs = input.sourcePositionMs;
    active.rate = input.rate;
    if (active.phase === 'approaching-end') {
      this.scheduleMarkerDeadline(END_DEADLINE_SLACK_MS);
    }
    return true;
  }

  clear(): void {
    this.clearDeadline();
    this.active = null;
  }

  isArmedFor(commandGeneration: number): boolean {
    return this.active?.commandGeneration === commandGeneration && !this.active.triggered;
  }

  isInPostRoll(): boolean {
    return this.active?.phase === 'post-roll' && !this.active.triggered;
  }

  private scheduleMarkerDeadline(slackMs: number): void {
    const active = this.active;
    if (active === null || active.phase !== 'approaching-end') {
      return;
    }

    this.clearDeadline();
    const remainingSourceMs = Math.max(0, active.clipEndMs - active.sourcePositionMs);
    const delayMs = remainingSourceMs / active.rate + slackMs;
    this.deadline = this.scheduler.setTimeout(() => this.beginPostRoll(), delayMs);
  }

  private beginPostRoll(): void {
    const active = this.active;
    if (active === null || active.triggered || active.phase === 'post-roll') {
      return;
    }

    this.clearDeadline();
    active.phase = 'post-roll';
    active.postRollStartedAtMs = this.scheduler.now();
    this.deadline = this.scheduler.setTimeout(() => this.trigger(), active.postRollMs);
  }

  private trigger(): void {
    const active = this.active;
    if (active === null || active.triggered) {
      return;
    }

    active.triggered = true;
    this.clearDeadline();
    const elapsedMs =
      active.postRollStartedAtMs === null
        ? active.postRollMs
        : Math.max(0, this.scheduler.now() - active.postRollStartedAtMs);
    active.onEnd({
      commandGeneration: active.commandGeneration,
      postRollOvershootMs: Math.max(0, elapsedMs - active.postRollMs),
    });
  }

  private clearDeadline(): void {
    if (this.deadline !== null) {
      this.scheduler.clearTimeout(this.deadline);
      this.deadline = null;
    }
  }
}

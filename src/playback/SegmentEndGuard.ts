export const END_GUARD_MS = 30;
export const END_DEADLINE_SLACK_MS = 20;

export interface SegmentEndGuardScheduler {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export interface SegmentEndGuardArm {
  readonly commandGeneration: number;
  readonly sourcePositionMs: number;
  readonly clipEndMs: number;
  readonly rate: number;
  readonly onEnd: (commandGeneration: number) => void;
}

export interface SegmentEndGuardObservation {
  readonly commandGeneration: number;
  readonly sourcePositionMs: number;
  readonly playing: boolean;
}

interface ActiveGuard extends SegmentEndGuardArm {
  triggered: boolean;
}

const defaultScheduler: SegmentEndGuardScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Guards a single practice range with the native status stream plus one
 * generation-scoped deadline. It never creates a polling interval.
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
      input.rate <= 0
    ) {
      return;
    }

    this.active = { ...input, triggered: false };
    const remainingSourceMs = input.clipEndMs - input.sourcePositionMs;
    const delayMs = Math.max(0, remainingSourceMs / input.rate) + END_DEADLINE_SLACK_MS;
    this.deadline = this.scheduler.setTimeout(() => {
      this.trigger(input.commandGeneration);
    }, delayMs);
  }

  observe(observation: SegmentEndGuardObservation): boolean {
    const active = this.active;
    if (
      active === null ||
      active.triggered ||
      !observation.playing ||
      observation.commandGeneration !== active.commandGeneration ||
      !isFiniteNonNegative(observation.sourcePositionMs) ||
      observation.sourcePositionMs < active.clipEndMs - END_GUARD_MS
    ) {
      return false;
    }

    return this.trigger(observation.commandGeneration);
  }

  clear(): void {
    if (this.deadline !== null) {
      this.scheduler.clearTimeout(this.deadline);
      this.deadline = null;
    }
    this.active = null;
  }

  isArmedFor(commandGeneration: number): boolean {
    return this.active?.commandGeneration === commandGeneration && !this.active.triggered;
  }

  private trigger(commandGeneration: number): boolean {
    const active = this.active;
    if (active === null || active.triggered || active.commandGeneration !== commandGeneration) {
      return false;
    }

    active.triggered = true;
    if (this.deadline !== null) {
      this.scheduler.clearTimeout(this.deadline);
      this.deadline = null;
    }
    active.onEnd(commandGeneration);
    return true;
  }
}

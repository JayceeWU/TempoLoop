import {
  END_DEADLINE_SLACK_MS,
  END_GUARD_MS,
  PRACTICE_POST_ROLL_MS,
  SegmentEndGuard,
} from '@/playback/SegmentEndGuard';

describe('SegmentEndGuard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts a two-second wall-clock post-roll at the native segment boundary', () => {
    const onEnd = jest.fn();
    const guard = new SegmentEndGuard();
    guard.arm({
      commandGeneration: 7,
      sourcePositionMs: 4_000,
      clipEndMs: 10_000,
      rate: 1,
      postRollMs: PRACTICE_POST_ROLL_MS,
      onEnd,
    });

    expect(
      guard.observe({
        commandGeneration: 7,
        sourcePositionMs: 10_000 - END_GUARD_MS - 1,
        playing: true,
      }),
    ).toBe(false);
    expect(guard.observe({ commandGeneration: 7, sourcePositionMs: 10_000, playing: true })).toBe(
      true,
    );
    expect(guard.isInPostRoll()).toBe(true);

    jest.advanceTimersByTime(PRACTICE_POST_ROLL_MS - 1);
    expect(onEnd).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledWith({ commandGeneration: 7, postRollOvershootMs: 0 });
  });

  it('uses a rate-adjusted marker deadline before the fixed post-roll', () => {
    const onEnd = jest.fn();
    const guard = new SegmentEndGuard();
    guard.arm({
      commandGeneration: 3,
      sourcePositionMs: 2_000,
      clipEndMs: 5_000,
      rate: 0.75,
      postRollMs: PRACTICE_POST_ROLL_MS,
      onEnd,
    });

    jest.advanceTimersByTime(3_000 / 0.75 + END_DEADLINE_SLACK_MS);
    expect(guard.isInPostRoll()).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();
    jest.advanceTimersByTime(PRACTICE_POST_ROLL_MS);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not restart the post-roll deadline when speed changes', () => {
    const onEnd = jest.fn();
    const guard = new SegmentEndGuard();
    guard.arm({
      commandGeneration: 8,
      sourcePositionMs: 9_900,
      clipEndMs: 10_000,
      rate: 1,
      postRollMs: PRACTICE_POST_ROLL_MS,
      onEnd,
    });
    guard.observe({ commandGeneration: 8, sourcePositionMs: 10_000, playing: true });
    jest.advanceTimersByTime(1_000);

    expect(guard.updateRate({ commandGeneration: 9, sourcePositionMs: 11_000, rate: 0.6 })).toBe(
      true,
    );
    jest.advanceTimersByTime(999);
    expect(onEnd).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledWith({ commandGeneration: 9, postRollOvershootMs: 0 });
  });

  it('ignores paused and stale observations and clears both deadlines', () => {
    const onEnd = jest.fn();
    const guard = new SegmentEndGuard();
    guard.arm({
      commandGeneration: 4,
      sourcePositionMs: 0,
      clipEndMs: 1_000,
      rate: 1,
      postRollMs: PRACTICE_POST_ROLL_MS,
      onEnd,
    });

    expect(guard.observe({ commandGeneration: 3, sourcePositionMs: 1_000, playing: true })).toBe(
      false,
    );
    expect(guard.observe({ commandGeneration: 4, sourcePositionMs: 1_000, playing: false })).toBe(
      false,
    );

    guard.clear();
    jest.runAllTimers();
    expect(onEnd).not.toHaveBeenCalled();
    expect(guard.isArmedFor(4)).toBe(false);
  });
});

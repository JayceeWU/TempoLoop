import { END_DEADLINE_SLACK_MS, END_GUARD_MS, SegmentEndGuard } from '@/playback/SegmentEndGuard';

describe('SegmentEndGuard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('finishes once from the native status stream at the guarded boundary', () => {
    const onEnd = jest.fn();
    const guard = new SegmentEndGuard();
    guard.arm({
      commandGeneration: 7,
      sourcePositionMs: 4_000,
      clipEndMs: 10_000,
      rate: 1,
      onEnd,
    });

    expect(
      guard.observe({
        commandGeneration: 7,
        sourcePositionMs: 10_000 - END_GUARD_MS - 1,
        playing: true,
      }),
    ).toBe(false);
    expect(
      guard.observe({
        commandGeneration: 7,
        sourcePositionMs: 10_000 - END_GUARD_MS,
        playing: true,
      }),
    ).toBe(true);
    expect(onEnd).toHaveBeenCalledTimes(1);

    jest.runAllTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('uses one rate-adjusted deadline when status delivery stalls', () => {
    const onEnd = jest.fn();
    const guard = new SegmentEndGuard();
    guard.arm({
      commandGeneration: 3,
      sourcePositionMs: 2_000,
      clipEndMs: 5_000,
      rate: 0.75,
      onEnd,
    });

    jest.advanceTimersByTime(3_000 / 0.75 + END_DEADLINE_SLACK_MS - 1);
    expect(onEnd).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledWith(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('ignores paused and stale observations and clears its deadline', () => {
    const onEnd = jest.fn();
    const guard = new SegmentEndGuard();
    guard.arm({
      commandGeneration: 4,
      sourcePositionMs: 0,
      clipEndMs: 1_000,
      rate: 1,
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

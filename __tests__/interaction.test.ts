import { PLAYBACK_TOGGLE_GUARD_MS, canAcceptPlaybackToggle } from '@/utils/interaction';

describe('playback interaction guard', () => {
  it('accepts the first press and rejects accidental presses inside 150 ms', () => {
    expect(canAcceptPlaybackToggle(null, 1_000)).toBe(true);
    expect(canAcceptPlaybackToggle(1_000, 1_000 + PLAYBACK_TOGGLE_GUARD_MS - 1)).toBe(false);
    expect(canAcceptPlaybackToggle(1_000, 1_000 + PLAYBACK_TOGGLE_GUARD_MS)).toBe(true);
  });

  it('recovers safely from a backwards or invalid clock value', () => {
    expect(canAcceptPlaybackToggle(1_000, 900)).toBe(true);
    expect(canAcceptPlaybackToggle(1_000, Number.NaN)).toBe(false);
  });
});

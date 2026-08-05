export const PLAYBACK_TOGGLE_GUARD_MS = 150;

/**
 * A timer-free guard for accidental play/pause double taps. A backwards clock
 * is treated as a fresh interaction so a device time correction cannot lock
 * the control.
 */
export function canAcceptPlaybackToggle(
  lastAcceptedAtMs: number | null,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(nowMs)) {
    return false;
  }

  if (lastAcceptedAtMs === null || !Number.isFinite(lastAcceptedAtMs) || nowMs < lastAcceptedAtMs) {
    return true;
  }

  return nowMs - lastAcceptedAtMs >= PLAYBACK_TOGGLE_GUARD_MS;
}

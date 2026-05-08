export const PLAYBACK_SPEED_OPTIONS = [0.5, 0.8, 1, 1.2, 1.5, 1.7, 2, 2.5];

const PLAYBACK_SPEED_STORAGE_KEY = "clips.playbackSpeed";
const MIN_PLAYBACK_SPEED = 0.25;
const MAX_PLAYBACK_SPEED = 4;

export function parsePlaybackSpeed(value: unknown): number | null {
  const rate =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(rate)) return null;
  if (rate < MIN_PLAYBACK_SPEED || rate > MAX_PLAYBACK_SPEED) return null;
  return rate;
}

export function readPlaybackSpeedPreference(fallback: number): number {
  const fallbackSpeed = parsePlaybackSpeed(fallback) ?? 1.2;
  if (typeof window === "undefined") return fallbackSpeed;

  try {
    return (
      parsePlaybackSpeed(window.localStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY)) ??
      fallbackSpeed
    );
  } catch {
    return fallbackSpeed;
  }
}

export function savePlaybackSpeedPreference(rate: number): void {
  const speed = parsePlaybackSpeed(rate);
  if (speed === null || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, String(speed));
  } catch {
    // Ignore storage failures; the active player should still update.
  }
}

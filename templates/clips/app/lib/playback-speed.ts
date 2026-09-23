export const PLAYBACK_SPEED_OPTIONS = [0.5, 0.8, 1, 1.2, 1.5, 1.7, 2, 2.5];

/**
 * Crawling speeds, offered while redacting so a box can be checked against
 * what is actually on screen.
 *
 * A sixteenth is the floor because that is where browsers stop: Chrome's
 * `playbackRate` range is 0.0625 to 16, and asking for less either clamps or
 * throws depending on the engine. Below about half speed the audio is dropped
 * too, which is the browser, not us.
 */
export const SLOW_PLAYBACK_SPEED_OPTIONS = [0.0625, 0.125, 0.25];

/** Below this a speed is a checking tool, not a preference worth remembering. */
export const SLOW_SPEED_CEILING = 0.25;

const PLAYBACK_SPEED_STORAGE_KEY = "clips.playbackSpeed";
const MIN_PLAYBACK_SPEED = 0.0625;
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
      parsePlaybackSpeed(
        window.localStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY),
      ) ?? fallbackSpeed
    );
  } catch {
    return fallbackSpeed;
  }
}

export function savePlaybackSpeedPreference(rate: number): void {
  const speed = parsePlaybackSpeed(rate);
  if (speed === null || typeof window === "undefined") return;
  // A crawl chosen to inspect a redaction is not how the person wants their
  // next recording to open.
  if (speed < SLOW_SPEED_CEILING) return;

  try {
    window.localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, String(speed));
  } catch {
    // Ignore storage failures; the active player should still update.
  }
}

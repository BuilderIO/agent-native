/**
 * What the Clip player does with a playback grant: when to ask for the next
 * one, and how to move a playing `<video>` onto its URLs without the reader
 * noticing more than a short rebuffer.
 */

/** Ask again this long before a grant's URLs stop working. */
export const GRANT_REFRESH_LEAD_MS = 30_000;
/** Never ask again sooner than this, even for a grant already near its end. */
export const MIN_GRANT_REFRESH_DELAY_MS = 5_000;
/** After a refresh Clips didn't answer, ask again after each of these in turn,
 *  while the grant still runs. */
export const GRANT_REFRESH_RETRY_DELAYS_MS = [5_000, 15_000, 60_000] as const;

export function grantRefreshDelay(expiresAt: string, now: number): number {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return MIN_GRANT_REFRESH_DELAY_MS;
  return Math.max(
    MIN_GRANT_REFRESH_DELAY_MS,
    expiresAtMs - now - GRANT_REFRESH_LEAD_MS,
  );
}

export interface MediaState {
  currentTime: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
}

type SwappableMedia = Pick<
  HTMLMediaElement,
  | "currentTime"
  | "paused"
  | "volume"
  | "muted"
  | "playbackRate"
  | "src"
  | "load"
  | "play"
  | "addEventListener"
  | "removeEventListener"
>;

export function captureMediaState(media: SwappableMedia): MediaState {
  return {
    currentTime: media.currentTime,
    paused: media.paused,
    volume: media.volume,
    muted: media.muted,
    playbackRate: media.playbackRate,
  };
}

const pendingRestores = new WeakMap<
  SwappableMedia,
  { state: MediaState; restore: () => void }
>();

/**
 * Where the reader is in `media`. A source swapped out before its metadata
 * loaded never held the reader's place; the element only shows what `load()`
 * reset it to, so the place read before that source is the reader's.
 */
export function mediaPlace(media: SwappableMedia): MediaState {
  return pendingRestores.get(media)?.state ?? captureMediaState(media);
}

/**
 * Points `media` at `src` and, once the new source knows its length, puts
 * back where the reader was: time, play or pause, volume and rate. Loading a
 * source resets all of them, so they are read before the swap. `place` puts
 * a new element where an earlier one left off.
 */
export function swapMediaSource(
  media: SwappableMedia,
  src: string,
  place?: MediaState,
): void {
  // Drop a pending restore so it can't run on this source.
  const pending = pendingRestores.get(media);
  if (pending) media.removeEventListener("loadedmetadata", pending.restore);
  const state = place ?? mediaPlace(media);
  const restore = () => {
    media.removeEventListener("loadedmetadata", restore);
    pendingRestores.delete(media);
    media.currentTime = state.currentTime;
    media.volume = state.volume;
    media.muted = state.muted;
    media.playbackRate = state.playbackRate;
    if (!state.paused) {
      void Promise.resolve(media.play()).catch(() => {
        // The browser can refuse to resume without a fresh gesture; the
        // reader then sees the paused player and presses play.
      });
    }
  };
  pendingRestores.set(media, { state, restore });
  media.addEventListener("loadedmetadata", restore);
  media.src = src;
  media.load();
}

const YOUTUBE_EMBED =
  /^https:\/\/www\.youtube\.com\/embed\/([A-Za-z0-9_-]{11})$/;

/**
 * The player URL for a Clip that plays from YouTube, or null when Clips
 * handed back anything but a bare YouTube embed URL.
 */
export function youtubeEmbedSrc(videoUrl: string | null): string | null {
  const videoId = videoUrl?.match(YOUTUBE_EMBED)?.[1];
  return videoId
    ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`
    : null;
}

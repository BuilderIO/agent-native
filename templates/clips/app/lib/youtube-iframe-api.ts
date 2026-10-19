// The subset of YouTube's IFrame Player API that Clips drives. Clips never
// downloads YouTube media: playback stays inside YouTube's embedded player and
// Clips only reads its clock and calls its transport controls.
// https://developers.google.com/youtube/iframe_api_reference

export const YOUTUBE_PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  destroy(): void;
}

export interface YouTubePlayerEvent<T = unknown> {
  target: YouTubePlayer;
  data: T;
}

export interface YouTubePlayerOptions {
  host?: string;
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YouTubePlayerEvent) => void;
    onStateChange?: (event: YouTubePlayerEvent<number>) => void;
    onPlaybackRateChange?: (event: YouTubePlayerEvent<number>) => void;
    onError?: (event: YouTubePlayerEvent<number>) => void;
  };
}

interface YouTubeNamespace {
  Player: new (
    element: HTMLElement,
    options: YouTubePlayerOptions,
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeNamespace & { loaded?: number };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const IFRAME_API_SRC = "https://www.youtube.com/iframe_api";
const IFRAME_API_TIMEOUT_MS = 15_000;

let apiPromise: Promise<YouTubeNamespace> | null = null;

export function loadYouTubeIframeApi(): Promise<YouTubeNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("YouTube's player needs a browser."));
  }
  if (window.YT?.Player && window.YT.loaded) {
    return Promise.resolve(window.YT);
  }
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      fail(new Error("YouTube's player took too long to load."));
    }, IFRAME_API_TIMEOUT_MS);
    // A failed load is retried on the next mount instead of being cached, so
    // it hands the global ready hook back rather than leaving a stale handler
    // for the next attempt to chain onto.
    const fail = (error: Error) => {
      window.clearTimeout(timeout);
      window.onYouTubeIframeAPIReady = previousReady;
      apiPromise = null;
      script.remove();
      reject(error);
    };
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      window.clearTimeout(timeout);
      if (window.YT?.Player) resolve(window.YT);
      else fail(new Error("YouTube's player loaded without its API."));
    };

    const script = document.createElement("script");
    script.src = IFRAME_API_SRC;
    script.async = true;
    script.onerror = () => fail(new Error("YouTube's player couldn't load."));
    document.head.appendChild(script);
  });
  return apiPromise;
}

export type YouTubePlaybackError =
  | "unavailable"
  | "embed_blocked"
  | "invalid"
  | "playback"
  | "api_unavailable";

/** Maps the IFrame API's `onError` codes onto the cases a viewer can act on. */
export function youtubePlaybackErrorFromCode(
  code: number,
): YouTubePlaybackError {
  switch (code) {
    case 100:
      return "unavailable";
    case 101:
    case 150:
      return "embed_blocked";
    case 2:
      return "invalid";
    default:
      return "playback";
  }
}

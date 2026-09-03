/**
 * Client-side video filmstrip frame extraction — the fallback for when the
 * server has no ffmpeg to generate a sprite (see
 * `server/lib/video-filmstrip-sprite.ts`, which is the preferred path).
 *
 * Two constraints this file exists to hold:
 *
 * 1. Sampling is at cell midpoints, not endpoints. The strip renders N equal
 *    cells spanning the clip, so cell `i` must show the frame at its midpoint;
 *    endpoint sampling puts every thumbnail up to half a cell away from the
 *    time underneath it.
 * 2. A blank frame is kept, not dropped. Dropping desynchronises every cell
 *    after it, and a genuinely black moment is indistinguishable from a seek
 *    that never decoded. All-blank is reported as a failure instead.
 *
 * The caller must pass a same-origin URL (`getWaveformMediaUrl`). Reading
 * pixels back out of a cross-origin video taints the canvas and `toDataURL`
 * throws, so a provider URL must be proxied before it reaches this function.
 */

import { canvasHasVisibleContent } from "./thumbnail-capture";

export interface FilmstripFrame {
  timeMs: number;
  dataUrl: string;
  /** Probed as blank. Kept so cells stay aligned with their time slots. */
  blank: boolean;
}

/**
 * A server-generated filmstrip sprite: one image holding `frameCount` frames in
 * a `columns` x `rows` grid, each cell `frameWidth` x `frameHeight`. Frames are
 * cell midpoints across the clip, matching this module's sampling.
 */
export interface FilmstripSprite {
  url: string;
  frameCount: number;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
}

export type FilmstripStatus =
  | "ok"
  | "skipped-no-window"
  | "skipped-no-media"
  | "failed-metadata"
  | "failed-canvas"
  | "failed-all-frames-blank";

export interface FilmstripResult {
  status: FilmstripStatus;
  frames: FilmstripFrame[];
  /** Intrinsic aspect (w/h) so callers can size cells to match the video. */
  aspectRatio: number | null;
  detail?: string;
}

export interface ExtractFilmstripOptions {
  videoUrl: string;
  durationMs: number;
  frameCount?: number;
  frameWidth?: number;
  quality?: number;
}

const METADATA_TIMEOUT_MS = 10_000;
const SEEK_TIMEOUT_MS = 2_000;
const FRAME_PRESENT_TIMEOUT_MS = 120;

/**
 * Midpoints of `frameCount` equal cells spanning `durationMs`. See the file
 * header for why these are midpoints rather than `0 … durationMs` inclusive.
 */
export function calculateFilmstripTimestamps(
  durationMs: number,
  frameCount: number = 20,
): number[] {
  if (durationMs <= 0 || frameCount <= 0) return [0];

  const cell = durationMs / frameCount;
  const timestamps: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    timestamps.push(Math.min(durationMs, Math.round((i + 0.5) * cell)));
  }
  return timestamps;
}

type MetadataOutcome = "ok" | "error" | "timeout";

function awaitMetadata(video: HTMLVideoElement): Promise<MetadataOutcome> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve("ok");
  }
  return new Promise<MetadataOutcome>((resolve) => {
    const settle = (outcome: MetadataOutcome) => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      resolve(outcome);
    };
    const onLoaded = () => settle("ok");
    const onError = () => settle("error");
    const timer = setTimeout(() => settle("timeout"), METADATA_TIMEOUT_MS);

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
  });
}

/** Resolves once the seek completed, or on timeout. */
function awaitSeek(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const settle = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const onSeeked = () => settle();
    const timer = setTimeout(settle, SEEK_TIMEOUT_MS);

    video.addEventListener("seeked", onSeeked);
    video.currentTime = timeSec;
  });
}

/**
 * `seeked` fires when the seek lands, which is not the same as the new frame
 * having been presented for compositing. Without this wait the canvas often
 * captures the previous frame, or nothing at all.
 */
function awaitPresentedFrame(video: HTMLVideoElement): Promise<void> {
  const withFrameCallback = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  };
  if (typeof withFrameCallback.requestVideoFrameCallback !== "function") {
    return new Promise<void>((resolve) =>
      setTimeout(resolve, FRAME_PRESENT_TIMEOUT_MS),
    );
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    withFrameCallback.requestVideoFrameCallback?.(settle);
    setTimeout(settle, FRAME_PRESENT_TIMEOUT_MS);
  });
}

export async function extractFilmstripThumbnails(
  options: ExtractFilmstripOptions,
): Promise<FilmstripResult> {
  const {
    videoUrl,
    durationMs,
    frameCount = 20,
    frameWidth = 160,
    quality = 0.72,
  } = options;

  if (typeof window === "undefined") {
    return { status: "skipped-no-window", frames: [], aspectRatio: null };
  }
  if (!videoUrl || durationMs <= 0) {
    return { status: "skipped-no-media", frames: [], aspectRatio: null };
  }

  const video = document.createElement("video");
  // Deliberately no `crossOrigin`: the caller passes a same-origin URL, and
  // requesting CORS mode on media the proxy already made same-origin only
  // adds a way for the load to fail.
  video.muted = true;
  video.preload = "auto";
  video.src = videoUrl;

  try {
    const metadata = await awaitMetadata(video);
    if (metadata !== "ok") {
      return {
        status: "failed-metadata",
        frames: [],
        aspectRatio: null,
        detail:
          metadata === "timeout"
            ? `Video metadata did not load within ${METADATA_TIMEOUT_MS}ms`
            : "Video failed to load",
      };
    }

    const intrinsicWidth = video.videoWidth;
    const intrinsicHeight = video.videoHeight;
    const aspectRatio =
      intrinsicWidth > 0 && intrinsicHeight > 0
        ? intrinsicWidth / intrinsicHeight
        : null;

    const canvas = document.createElement("canvas");
    canvas.width = frameWidth;
    canvas.height = Math.max(
      1,
      Math.round(frameWidth / (aspectRatio ?? 16 / 9)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return {
        status: "failed-canvas",
        frames: [],
        aspectRatio,
        detail: "Could not acquire a 2d canvas context",
      };
    }

    const frames: FilmstripFrame[] = [];
    let blankCount = 0;

    for (const timeMs of calculateFilmstripTimestamps(durationMs, frameCount)) {
      await awaitSeek(video, timeMs / 1000);
      await awaitPresentedFrame(video);

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blank = !canvasHasVisibleContent(canvas);
      if (blank) blankCount++;

      let dataUrl: string;
      try {
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      } catch (err) {
        // The only realistic cause is a tainted canvas, i.e. the caller passed
        // a cross-origin URL. Report it rather than returning a short strip.
        return {
          status: "failed-canvas",
          frames: [],
          aspectRatio,
          detail: `Canvas read failed (cross-origin media?): ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }

      frames.push({ timeMs, dataUrl, blank });
    }

    if (frames.length > 0 && blankCount === frames.length) {
      return {
        status: "failed-all-frames-blank",
        frames: [],
        aspectRatio,
        detail: `All ${frames.length} sampled frames probed as blank`,
      };
    }

    return { status: "ok", frames, aspectRatio };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

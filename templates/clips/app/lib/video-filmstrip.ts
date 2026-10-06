import { canvasHasVisibleContent } from "./thumbnail-capture";

export interface FilmstripFrame {
  timeMs: number;
  dataUrl: string;
  blank: boolean;
}

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

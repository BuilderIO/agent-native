import type { ThumbnailSpec } from "./timestamp-mapping";

export type ThumbnailPickerTab = "upload" | "frame" | "gif";

export interface ThumbnailPickerState {
  tab: ThumbnailPickerTab;
  frameTime: number;
  gifStart: number;
  gifDuration: number;
}

const DEFAULT_GIF_DURATION_MS = 3_000;
const MIN_GIF_DURATION_MS = 500;
const MAX_GIF_DURATION_MS = 10_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function parseGifValue(value: string): {
  startMs?: unknown;
  durationMs?: unknown;
} {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as { startMs?: unknown; durationMs?: unknown };
  } catch {
    // coercion-ok: malformed saved GIF metadata falls back to safe picker defaults.
    return {};
  }
}

export function resolveThumbnailPickerState(
  thumbnail: ThumbnailSpec | null | undefined,
  options: {
    durationMs: number;
    hasAnimatedThumbnail?: boolean;
  },
): ThumbnailPickerState {
  const durationMs = Math.max(0, finiteNumber(options.durationMs, 0));
  const frameMax = Math.max(1_000, durationMs);
  const defaultGifDuration = clamp(
    DEFAULT_GIF_DURATION_MS,
    MIN_GIF_DURATION_MS,
    MAX_GIF_DURATION_MS,
  );

  if (thumbnail?.kind === "frame") {
    return {
      tab: "frame",
      frameTime: clamp(finiteNumber(Number(thumbnail.value), 0), 0, frameMax),
      gifStart: 0,
      gifDuration: defaultGifDuration,
    };
  }

  if (thumbnail?.kind === "gif") {
    const gif = parseGifValue(thumbnail.value);
    const gifDuration = clamp(
      finiteNumber(gif.durationMs, defaultGifDuration),
      MIN_GIF_DURATION_MS,
      MAX_GIF_DURATION_MS,
    );
    return {
      tab: "gif",
      frameTime: 0,
      gifStart: clamp(
        finiteNumber(gif.startMs, 0),
        0,
        Math.max(0, durationMs - gifDuration),
      ),
      gifDuration,
    };
  }

  return {
    tab:
      thumbnail?.kind === "url"
        ? "upload"
        : options.hasAnimatedThumbnail
          ? "gif"
          : "frame",
    frameTime: 0,
    gifStart: 0,
    gifDuration: defaultGifDuration,
  };
}

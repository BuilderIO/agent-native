/**
 * Generate a filmstrip sprite — one JPEG holding a grid of evenly-spaced video
 * frames — so the editor timeline renders thumbnails as a single cached image
 * request instead of decoding the video in the browser.
 *
 * Why a sprite rather than per-frame files: one ffmpeg pass, one upload, one
 * HTTP request, and the grid geometry is enough for CSS `background-position`
 * to address any cell. The browser fallback in `app/lib/video-filmstrip.ts`
 * needs one seek per frame and cannot read cross-origin media at all.
 *
 * Three constraints worth keeping in mind:
 *
 *   - Cells are padded to an exact size (`force_original_aspect_ratio=decrease`
 *     plus `pad`) so the returned grid geometry is exact without probing the
 *     source. Letterboxed bars on odd aspect ratios are the deliberate cost of
 *     not having to decode the output to learn its dimensions.
 *   - Sampling starts half a cell in, matching the browser fallback: cell `i`
 *     shows the midpoint of the time slot it occupies, not its leading edge.
 *   - Input arrives as bytes and is written to a temp file, like every other
 *     ffmpeg path here. That means the whole file is buffered in memory by the
 *     caller, which is the practical ceiling on this approach for long
 *     recordings on small hosts.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isFfmpegAvailable, runFfmpeg, withRemuxSlot } from "./video-remux.js";

const SPRITE_TIMEOUT_MS = 90_000;

export const DEFAULT_FILMSTRIP_FRAME_COUNT = 40;
// A sprite is decoded whole by the browser, so cap the grid: 120 cells at the
// default size is already a ~1600x1080 image.
export const MAX_FILMSTRIP_FRAME_COUNT = 120;
export const DEFAULT_FILMSTRIP_FRAME_WIDTH = 160;
export const DEFAULT_FILMSTRIP_FRAME_HEIGHT = 90;
export const DEFAULT_FILMSTRIP_COLUMNS = 10;

export type FilmstripSpriteStatus =
  | "generated"
  | "skipped-no-ffmpeg"
  | "skipped-no-duration"
  | "skipped-no-media"
  | "failed-ffmpeg"
  | "failed-empty-output";

/** Everything the UI needs to address one cell of the sprite. */
export interface FilmstripSpriteGrid {
  frameCount: number;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
}

export interface FilmstripSpriteResult {
  status: FilmstripSpriteStatus;
  /** Present only when `status === "generated"`. */
  sprite?: { bytes: Uint8Array; grid: FilmstripSpriteGrid };
  detail?: string;
}

export interface GenerateFilmstripSpriteInput {
  mediaBytes: Uint8Array;
  durationMs: number;
  frameCount?: number;
  frameWidth?: number;
  frameHeight?: number;
  columns?: number;
}

/**
 * Lay `frameCount` cells out into a grid no wider than `columns`. Exported so
 * callers can compute the same geometry the sprite will have without
 * regenerating it.
 */
export function filmstripGrid(input: {
  frameCount: number;
  columns: number;
  frameWidth: number;
  frameHeight: number;
}): FilmstripSpriteGrid {
  const frameCount = Math.min(
    MAX_FILMSTRIP_FRAME_COUNT,
    Math.max(1, Math.floor(input.frameCount)),
  );
  const columns = Math.max(1, Math.min(input.columns, frameCount));
  return {
    frameCount,
    columns,
    rows: Math.ceil(frameCount / columns),
    frameWidth: input.frameWidth,
    frameHeight: input.frameHeight,
  };
}

/**
 * Build the ffmpeg filter chain that samples `frameCount` frames across
 * `durationMs` and tiles them into `grid`. Exported for tests: the sampling
 * offset and rate are the parts most likely to drift from the browser
 * fallback's expectations.
 */
export function filmstripSpriteFilter(input: {
  durationMs: number;
  grid: FilmstripSpriteGrid;
}): { seekSeconds: string; filter: string } {
  const { durationMs, grid } = input;
  const cellMs = durationMs / grid.frameCount;
  const fps = grid.frameCount / (durationMs / 1000);

  return {
    // Half a cell in, so each tile is the midpoint of its slot.
    seekSeconds: (cellMs / 2 / 1000).toFixed(6),
    filter: [
      `fps=${fps.toFixed(6)}`,
      `scale=${grid.frameWidth}:${grid.frameHeight}:force_original_aspect_ratio=decrease`,
      `pad=${grid.frameWidth}:${grid.frameHeight}:-1:-1:color=black`,
      `tile=${grid.columns}x${grid.rows}`,
    ].join(","),
  };
}

export async function generateFilmstripSprite(
  input: GenerateFilmstripSpriteInput,
): Promise<FilmstripSpriteResult> {
  const {
    mediaBytes,
    durationMs,
    frameCount = DEFAULT_FILMSTRIP_FRAME_COUNT,
    frameWidth = DEFAULT_FILMSTRIP_FRAME_WIDTH,
    frameHeight = DEFAULT_FILMSTRIP_FRAME_HEIGHT,
    columns = DEFAULT_FILMSTRIP_COLUMNS,
  } = input;

  if (mediaBytes.byteLength === 0) {
    return { status: "skipped-no-media" };
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { status: "skipped-no-duration" };
  }
  if (!isFfmpegAvailable()) {
    return {
      status: "skipped-no-ffmpeg",
      detail:
        "No ffmpeg binary available; the editor falls back to browser-side frame extraction.",
    };
  }

  const grid = filmstripGrid({ frameCount, columns, frameWidth, frameHeight });
  const { seekSeconds, filter } = filmstripSpriteFilter({ durationMs, grid });

  const dir = await mkdtemp(join(tmpdir(), "clips-filmstrip-"));
  const inputPath = join(dir, "input.media");
  const outputPath = join(dir, "sprite.jpg");

  try {
    await writeFile(inputPath, mediaBytes);
    await withRemuxSlot(() =>
      runFfmpeg(
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          // Input seeking: cheap, and puts the first sample at a cell midpoint.
          "-ss",
          seekSeconds,
          "-i",
          inputPath,
          "-an",
          "-sn",
          "-vf",
          filter,
          // The tile filter emits the finished grid as a single frame.
          "-frames:v",
          "1",
          "-q:v",
          "4",
          "-f",
          "image2",
          outputPath,
        ],
        { timeoutMs: SPRITE_TIMEOUT_MS, label: "filmstrip sprite" },
      ),
    );

    const bytes = new Uint8Array(await readFile(outputPath));
    if (bytes.byteLength === 0) {
      return {
        status: "failed-empty-output",
        detail: "ffmpeg reported success but wrote an empty sprite",
      };
    }

    return { status: "generated", sprite: { bytes, grid } };
  } catch (err) {
    return {
      status: "failed-ffmpeg",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

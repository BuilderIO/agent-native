import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isFfmpegAvailable, runFfmpeg, withRemuxSlot } from "./video-remux.js";

const SPRITE_TIMEOUT_MS = 90_000;

export const DEFAULT_FILMSTRIP_FRAME_COUNT = 40;
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

export interface FilmstripSpriteGrid {
  frameCount: number;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
}

export interface FilmstripSpriteResult {
  status: FilmstripSpriteStatus;
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

export function filmstripSpriteFilter(input: {
  durationMs: number;
  grid: FilmstripSpriteGrid;
}): { seekSeconds: string; filter: string } {
  const { durationMs, grid } = input;
  const cellMs = durationMs / grid.frameCount;
  const fps = grid.frameCount / (durationMs / 1000);

  return {
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
          "-ss",
          seekSeconds,
          "-i",
          inputPath,
          "-an",
          "-sn",
          "-vf",
          filter,
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

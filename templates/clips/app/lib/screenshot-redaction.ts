/**
 * Destroy pixels inside a region, irreversibly, the way the video editor does.
 *
 * A redaction never reads the picture it covers. It is painted either solid,
 * or with the video burn's grey streaks: blocks picked at random from a
 * palette and smeared into bands. A blur or an averaging mosaic would leave a
 * summary of what was there; this leaves nothing to work back from.
 *
 * The result is only as safe as what happens to it next: it must be uploaded
 * as a replacement for the stored image, with the original deleted. Drawing
 * this over a picture that is still being served is decoration, not redaction.
 */

import { DEFAULT_SOLID_FILL } from "./tokens/screenshot-colors";
import {
  MOSAIC_PALETTE,
  REDACTION_EDGE_COLOR,
  STREAK_ASPECT,
  STREAK_SIGMA,
  redactionEdgePx,
  streakUnitPx,
} from "./video-redactions";

export interface RedactionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How a region is destroyed.
 *
 * `mosaic` — stored under that name for rows written before the look changed,
 * and shown as "Blur" — paints the grey streaks. `solid` paints one colour.
 * Neither reads the pixels underneath, so both destroy the same content; the
 * choice is how it looks.
 */
export type RedactionStyle = "mosaic" | "solid";

export const DEFAULT_REDACTION_STYLE: RedactionStyle = "mosaic";

// Painted into the picture, so defined with the other image colours.
export {
  DEFAULT_SOLID_FILL,
  SOLID_FILL_COLORS,
} from "./tokens/screenshot-colors";

/** Paint a region out entirely, leaving nothing to measure. */
export function fillRegion(
  canvas: HTMLCanvasElement,
  rect: RedactionRect,
  color: string = DEFAULT_SOLID_FILL,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not edit the image.");
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

/*
 * The streaks are the video burn's (see `mosaicChain` in
 * `video-redactions.ts`) drawn on a canvas, so a screenshot and a clip
 * redacted by the same person look the same.
 */

/** A number from a redaction's id, so its pattern holds still between redraws. */
export function streakSeed(id: string): number {
  let hash = 7;
  for (let i = 0; i < id.length; i++)
    hash = (hash * 31 + id.charCodeAt(i)) % 9973;
  return hash;
}

/** The same per-block hash the video burn uses, so the patterns match in kind. */
function paletteIndex(col: number, row: number, seed: number): number {
  const value =
    Math.sin((col + 1) * 12.9898 + (row + 1) * 78.233 + seed) * 43758.5453;
  return Math.floor(Math.abs(value)) % MOSAIC_PALETTE.length;
}

function clampedRect(canvas: HTMLCanvasElement, rect: RedactionRect) {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const right = Math.min(canvas.width, Math.round(rect.x + rect.width));
  const bottom = Math.min(canvas.height, Math.round(rect.y + rect.height));
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

/** Cover a region with grey streaks that owe nothing to what was there. */
export function streakRegion(
  canvas: HTMLCanvasElement,
  rect: RedactionRect,
  seed: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not edit the image.");
  const area = clampedRect(canvas, rect);
  if (!area.width || !area.height) return;

  const blockH = streakUnitPx(canvas.width);
  const blockW = blockH * STREAK_ASPECT;
  // One block of margin all round, so the blur has blocks to smear in from
  // at the edges instead of fading to transparent.
  const cols = Math.ceil(area.width / blockW) + 2;
  const rows = Math.ceil(area.height / blockH) + 2;
  const tile = document.createElement("canvas");
  tile.width = cols * blockW;
  tile.height = rows * blockH;
  const tileCtx = tile.getContext("2d");
  if (!tileCtx) throw new Error("This browser could not edit the image.");
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tileCtx.fillStyle = MOSAIC_PALETTE[paletteIndex(col, row, seed)];
      tileCtx.fillRect(col * blockW, row * blockH, blockW, blockH);
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.width, area.height);
  ctx.clip();
  // Opaque first. What hides the picture is this fill and the blocks, never
  // the blur — a browser without canvas filters just draws sharper streaks.
  ctx.fillStyle = MOSAIC_PALETTE[0];
  ctx.fillRect(area.x, area.y, area.width, area.height);
  ctx.filter = `blur(${(blockH * STREAK_SIGMA).toFixed(1)}px)`;
  ctx.drawImage(tile, area.x - blockW, area.y - blockH);
  ctx.restore();
}

/** The border every redaction gets, as the video burn draws it. */
export function strokeRedactionEdge(
  canvas: HTMLCanvasElement,
  rect: RedactionRect,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const area = clampedRect(canvas, rect);
  if (!area.width || !area.height) return;
  const edge = Math.min(
    redactionEdgePx(canvas.width),
    Math.floor(Math.min(area.width, area.height) / 2),
  );
  if (edge <= 0) return;
  ctx.save();
  ctx.strokeStyle = `#${REDACTION_EDGE_COLOR.slice(2)}`;
  ctx.lineWidth = edge;
  // Inside the box, as ffmpeg's drawbox does it.
  ctx.strokeRect(
    area.x + edge / 2,
    area.y + edge / 2,
    area.width - edge,
    area.height - edge,
  );
  ctx.restore();
}

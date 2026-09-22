/**
 * Read the pixels of a redacted area and say whether anything is left of it.
 *
 * Why this exists
 * ---------------
 * "The blur is applied" is not something a person can check by looking: the
 * editor draws its boxes *over* the picture, so an unburned redaction looks
 * exactly like a burned one — and the two are worlds apart, because an unburned
 * box hides nothing from a download, the network tab, the poster image or the
 * filmstrip. The only honest check reads the stored frames and measures whether
 * the covered rectangle still carries detail.
 *
 * Used by `scripts/verify-redaction.ts` against a real recording, and by this
 * module's own tests against a clip burned on the spot.
 *
 * What it measures, and why that way: `mosaic` leaves one colour per block and
 * `solid` leaves one colour overall, so destruction shows up as near-zero
 * spread *inside every block*. Averaging over the whole rectangle would score a
 * chessboard of flat blocks as detailed and miss the point.
 */

import { spawn } from "node:child_process";

import type { RedactionRect } from "../../app/lib/video-redactions.js";
import { resolveFfmpegCommand } from "./video-remux.js";

/**
 * Mean within-block spread, 0–255, below which an area carries no detail.
 *
 * Not zero, and it cannot be: the output is H.264, so even a perfectly flat
 * fill comes back with ringing and chroma-subsampling noise on it. Measured on
 * real burns, a mosaiced or filled area sits under 4 and ordinary screen
 * content — text, window edges, a photo — runs from 15 into the 60s, so this
 * sits in a wide gap.
 */
export const DESTROYED_MAX_SPREAD = 8;
/**
 * How many of an area's blocks must be one flat colour for it to count as
 * destroyed, when the spread alone does not settle it.
 *
 * Not all of them: a rectangle measured from stored coordinates lands within a
 * pixel or two of the one the burn cropped, so the odd block at the rim
 * legitimately carries real picture.
 */
export const MIN_FLAT_BLOCKS = 0.9;
/** Below this a control sample is too featureless to prove anything. */
export const CONTROL_MIN_SPREAD = 10;

export interface AreaDetail {
  /** Mean spread of brightness inside a block, 0–255. */
  spread: number;
  /** Fraction of blocks that are essentially one colour. */
  flatBlocks: number;
  /** How strongly a block grid shows in the area. ~1 means none at all. */
  gridStrength: number;
  /** Whether this area reads as destroyed rather than merely covered. */
  destroyed: boolean;
}

function lumaOf(bytes: Uint8Array, count: number): Float32Array {
  const luma = new Float32Array(count);
  for (let i = 0, p = 0; p < count; i += 3, p++) {
    // The eye reads text by brightness, and so does a mosaic.
    luma[p] = 0.299 * bytes[i] + 0.587 * bytes[i + 1] + 0.114 * bytes[i + 2];
  }
  return luma;
}

/**
 * Where the block grid starts.
 *
 * It cannot be assumed to start at the corner of the rectangle being measured.
 * `pixelize` tiles from the origin of the crop the burn took, and that crop is
 * union-sized and positioned by an expression evaluated per frame, so the grid
 * sits at whatever offset a rounded pixel lands on. Measuring on the wrong
 * phase makes every block straddle two tiles, and a perfectly destroyed area
 * then scores as detailed — the first version of this check called half of a
 * known-good burn a leak for exactly that reason.
 *
 * A mosaic leaves a hard step every `blockPx` pixels and nothing in between, so
 * the grid is found rather than guessed: given the mean pixel-to-pixel
 * difference per column (or row), pick the phase whose lines carry most of it.
 */
export function findGridPhase(
  diffProfile: number[],
  blockPx: number,
): { phase: number; strength: number } {
  const scores = new Array(blockPx).fill(0);
  const counts = new Array(blockPx).fill(0);
  for (let i = 1; i < diffProfile.length; i++) {
    scores[i % blockPx] += diffProfile[i];
    counts[i % blockPx] += 1;
  }
  let phase = 0;
  let bestMean = -1;
  let total = 0;
  for (let o = 0; o < blockPx; o++) {
    const mean = counts[o] ? scores[o] / counts[o] : 0;
    total += mean;
    if (mean > bestMean) {
      bestMean = mean;
      phase = o;
    }
  }
  const average = total / blockPx;
  return { phase, strength: average > 0 ? bestMean / average : 0 };
}

/**
 * Measure a raw RGB rectangle for leftover detail.
 *
 * Blocks are measured on the detected grid, and the outermost block on each
 * side is dropped: the rim is where this rectangle and the burn's union-sized
 * crop disagree by a pixel or two, and a sliver of real picture there says
 * nothing about whether the covered area was destroyed.
 */
/**
 * Detail left in an area that carries no block grid.
 *
 * The burn no longer leaves blocks: it lays down wide random bands and smears
 * them sideways, so `measureArea`'s question — is each block one colour? — has
 * nothing to measure and would answer no. What is true of the result instead is
 * that it holds no *edges*: a smeared field changes gradually everywhere, while
 * anything with text or a face in it changes sharply somewhere.
 *
 * So this measures the mean step between neighbouring pixels. Note what it
 * cannot do: a genuinely soft area of real video — an out-of-focus wall — also
 * has no edges, which is exactly why the caller takes a control sample outside
 * the box. A verdict here means "nothing sharp survived", not "this was
 * definitely redacted".
 */
export interface SmoothDetail {
  /** Mean step between neighbouring pixels, averaged over tiles, 0–255. */
  gradient: number;
  /** The worst single tile's mean step — where a leak shows. */
  worstTileGradient: number;
  /** The sharpest step found in any tile, which is where text would show. */
  peakGradient: number;
  destroyed: boolean;
}

/** Mean step below which a tile carries no edges. */
export const SMOOTH_MAX_GRADIENT = 3.5;
/** And its sharpest step has to stay low too, or one hard edge hides in a mean. */
export const SMOOTH_MAX_PEAK = 24;
/** A control sample with fewer edges than this proves nothing either way. */
export const CONTROL_MIN_GRADIENT = 6;
/** Side of the tiles the area is judged in. */
export const SMOOTH_TILE_PX = 24;

export function measureSmoothArea(input: {
  bytes: Uint8Array;
  width: number;
  height: number;
  /**
   * Pixels to ignore at each edge. The burn draws its own white border inside
   * the box, which is a hard edge by design: measured, it makes every small
   * box look like it still holds detail.
   */
  insetPx?: number;
  tilePx?: number;
}): SmoothDetail {
  const { width, height } = input;
  const inset = Math.max(0, Math.round(input.insetPx ?? 0));
  const tilePx = Math.max(4, Math.round(input.tilePx ?? SMOOTH_TILE_PX));
  const luma = lumaOf(input.bytes, width * height);
  const at = (x: number, y: number) => luma[y * width + x];

  const left = inset;
  const top = inset;
  const right = width - inset;
  const bottom = height - inset;
  if (right - left < 3 || bottom - top < 3) {
    return {
      gradient: 0,
      worstTileGradient: 0,
      peakGradient: 0,
      destroyed: false,
    };
  }

  // Judged tile by tile, not over the whole rectangle. Both numbers used to be
  // whole-area statistics, and a leak confined to part of the box — a fill
  // scaled too small, say — disappeared into them: the area averaged smooth
  // and was called destroyed while a third of it was still the original
  // picture. `measureArea` caught that because it asked its question of every
  // block; this asks its question of every tile.
  const tileMeans: number[] = [];
  let peak = 0;
  for (let ty = top; ty + 3 <= bottom; ty += tilePx) {
    for (let tx = left; tx + 3 <= right; tx += tilePx) {
      const tileRight = Math.min(tx + tilePx, right);
      const tileBottom = Math.min(ty + tilePx, bottom);
      let sum = 0;
      let count = 0;
      let tilePeak = 0;
      for (let y = ty + 1; y < tileBottom; y++) {
        for (let x = tx + 1; x < tileRight; x++) {
          const stepX = Math.abs(at(x, y) - at(x - 1, y));
          const stepY = Math.abs(at(x, y) - at(x, y - 1));
          sum += stepX + stepY;
          count += 2;
          if (stepX > tilePeak) tilePeak = stepX;
          if (stepY > tilePeak) tilePeak = stepY;
        }
      }
      if (count < 8) continue;
      tileMeans.push(sum / count);
      if (tilePeak > peak) peak = tilePeak;
    }
  }

  if (!tileMeans.length) {
    return {
      gradient: 0,
      worstTileGradient: 0,
      peakGradient: 0,
      destroyed: false,
    };
  }
  const gradient = tileMeans.reduce((a, b) => a + b, 0) / tileMeans.length;
  const worstTileGradient = Math.max(...tileMeans);
  return {
    gradient,
    worstTileGradient,
    peakGradient: peak,
    // Every tile has to be smooth, not the average of them.
    destroyed:
      worstTileGradient < SMOOTH_MAX_GRADIENT && peak < SMOOTH_MAX_PEAK,
  };
}

export function measureArea(input: {
  bytes: Uint8Array;
  width: number;
  height: number;
  blockPx: number;
}): AreaDetail {
  const { width, height, blockPx } = input;
  const luma = lumaOf(input.bytes, width * height);
  const at = (x: number, y: number) => luma[y * width + x];

  const colDiff: number[] = new Array(width).fill(0);
  for (let x = 1; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) sum += Math.abs(at(x, y) - at(x - 1, y));
    colDiff[x] = sum / height;
  }
  const rowDiff: number[] = new Array(height).fill(0);
  for (let y = 1; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) sum += Math.abs(at(x, y) - at(x, y - 1));
    rowDiff[y] = sum / width;
  }
  const xGrid = findGridPhase(colDiff, blockPx);
  const yGrid = findGridPhase(rowDiff, blockPx);

  /**
   * Measure the blocks, optionally skipping the outermost one on each side.
   *
   * `skipRim` is what we want, but it cannot be insisted on: a box a couple of
   * blocks tall — the shape of a redaction over a single line of text — has no
   * middle left once the rim is dropped. Falling through to measuring the whole
   * rectangle as one block instead was a false alarm waiting to happen, and it
   * happened: a mosaic measured whole reads as detailed, because the blocks
   * differ from each other, and a real burn was reported as a leak.
   */
  const tile = (skipRim: boolean) => {
    const inset = skipRim ? blockPx : 0;
    const spreads: number[] = [];
    let flat = 0;
    for (
      let by = yGrid.phase + inset;
      by + inset + blockPx <= height;
      by += blockPx
    ) {
      for (
        let bx = xGrid.phase + inset;
        bx + inset + blockPx <= width;
        bx += blockPx
      ) {
        let sum = 0;
        let sumSq = 0;
        let n = 0;
        // A one-pixel inset per block: the step between two blocks lands on
        // the boundary, and H.264 ringing puts it on the pixel either side.
        for (let y = by + 1; y < by + blockPx - 1; y++) {
          for (let x = bx + 1; x < bx + blockPx - 1; x++) {
            const v = at(x, y);
            sum += v;
            sumSq += v * v;
            n += 1;
          }
        }
        if (n < 4) continue;
        const mean = sum / n;
        const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
        spreads.push(sd);
        if (sd < DESTROYED_MAX_SPREAD) flat += 1;
      }
    }
    return { spreads, flat };
  };

  let { spreads, flat } = tile(true);
  if (!spreads.length) ({ spreads, flat } = tile(false));

  if (!spreads.length) {
    // Smaller than a single block: measuring it whole is all there is.
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < luma.length; i++) {
      sum += luma[i];
      sumSq += luma[i] * luma[i];
    }
    const mean = sum / luma.length;
    const sd = Math.sqrt(Math.max(0, sumSq / luma.length - mean * mean));
    return {
      spread: sd,
      flatBlocks: sd < DESTROYED_MAX_SPREAD ? 1 : 0,
      gridStrength: 0,
      destroyed: sd < DESTROYED_MAX_SPREAD,
    };
  }

  const spread = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  const flatBlocks = flat / spreads.length;
  return {
    spread,
    flatBlocks,
    gridStrength: Math.max(xGrid.strength, yGrid.strength),
    // Either test is enough, and between them they cover both styles: a
    // `solid` fill has no grid to find but no spread either, while a `mosaic`
    // is a grid of blocks each of which is one colour.
    destroyed: spread < DESTROYED_MAX_SPREAD || flatBlocks >= MIN_FLAT_BLOCKS,
  };
}

/**
 * Pull one frame's worth of a rectangle out of a video file, as raw RGB.
 *
 * `-ss` before `-i` seeks by keyframe and decodes forward, which is both fast
 * and accurate enough for a frame in the middle of a range. It is left off
 * entirely at zero: on a still image — a thumbnail, which is checked the same
 * way — `-ss 0` skips the one frame there is, and ffmpeg exits happily having
 * written nothing, which reads as "could not decode" rather than as a bug
 * here.
 */
export async function readCoveredArea(input: {
  inputPath: string;
  atMs: number;
  rect: RedactionRect;
  frameWidth: number;
  frameHeight: number;
}): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { rect, frameWidth, frameHeight } = input;
  // A frame size of zero is not a measurable frame, and it is a reachable
  // state: `recordings.width`/`height` default to 0 and are filled from values
  // the client may not send. Left to itself the arithmetic below would ask for
  // a 2x2 crop of the top-left corner, which measures flat and reports the
  // redaction destroyed without having looked at it. A checker that cannot
  // fail is worse than no checker.
  if (!(frameWidth > 0) || !(frameHeight > 0)) {
    throw new Error(
      `Cannot measure a redaction without the frame size (got ${frameWidth}x${frameHeight}).`,
    );
  }
  // Even pixel geometry: yuv420 chroma is subsampled, and an odd crop makes
  // ffmpeg round, which would shift the window off the box by a pixel.
  const w = Math.max(2, Math.round((rect.w * frameWidth) / 2) * 2);
  const h = Math.max(2, Math.round((rect.h * frameHeight) / 2) * 2);
  const x = Math.max(
    0,
    Math.min(frameWidth - w, Math.round(rect.x * frameWidth)),
  );
  const y = Math.max(
    0,
    Math.min(frameHeight - h, Math.round(rect.y * frameHeight)),
  );

  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      resolveFfmpegCommand(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        ...(input.atMs > 0 ? ["-ss", (input.atMs / 1000).toFixed(3)] : []),
        "-i",
        input.inputPath,
        "-frames:v",
        "1",
        "-filter:v",
        `crop=${w}:${h}:${x}:${y}`,
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(out))
        : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`)),
    );
  });

  return { bytes: new Uint8Array(bytes), width: w, height: h };
}

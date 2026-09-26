
import { spawn } from "node:child_process";

import type { RedactionRect } from "../../app/lib/video-redactions.js";
import { resolveFfmpegCommand } from "./video-remux.js";

export const DESTROYED_MAX_SPREAD = 8;
export const MIN_FLAT_BLOCKS = 0.9;
export const CONTROL_MIN_SPREAD = 10;

export interface AreaDetail {
  spread: number;
  flatBlocks: number;
  gridStrength: number;
  destroyed: boolean;
}

function lumaOf(bytes: Uint8Array, count: number): Float32Array {
  const luma = new Float32Array(count);
  for (let i = 0, p = 0; p < count; i += 3, p++) {
    luma[p] = 0.299 * bytes[i] + 0.587 * bytes[i + 1] + 0.114 * bytes[i + 2];
  }
  return luma;
}

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

export interface SmoothDetail {
  gradient: number;
  worstTileGradient: number;
  peakGradient: number;
  destroyed: boolean;
}

export const SMOOTH_MAX_GRADIENT = 3.5;
export const SMOOTH_MAX_PEAK = 24;
export const CONTROL_MIN_GRADIENT = 6;
export const SMOOTH_TILE_PX = 24;

export function measureSmoothArea(input: {
  bytes: Uint8Array;
  width: number;
  height: number;
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
    destroyed: spread < DESTROYED_MAX_SPREAD || flatBlocks >= MIN_FLAT_BLOCKS,
  };
}

export async function readCoveredArea(input: {
  inputPath: string;
  atMs: number;
  rect: RedactionRect;
  frameWidth: number;
  frameHeight: number;
}): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { rect, frameWidth, frameHeight } = input;
  if (!(frameWidth > 0) || !(frameHeight > 0)) {
    throw new Error(
      `Cannot measure a redaction without the frame size (got ${frameWidth}x${frameHeight}).`,
    );
  }
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

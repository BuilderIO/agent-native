/// <reference lib="dom" />
/**
 * Pixel comparison for Figma fidelity runs.
 *
 * Decoding happens inside the Chromium page the harness already launches for
 * rendering, so no image-codec dependency is needed. A dimension mismatch is a
 * reported failure rather than a silent resize: scaling one side to fit would
 * let a wrongly-sized import score as a near match.
 */
import type { Browser } from "@playwright/test";

export interface GridCell {
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  diffRatio: number;
  meanDelta: number;
}

export interface CompareResult {
  reference: { width: number; height: number };
  candidate: { width: number; height: number };
  dimensionMismatch: boolean;
  /** Pixels whose max channel delta exceeded `threshold`, over the compared area. */
  diffPixels: number;
  comparedPixels: number;
  diffRatio: number;
  maxDelta: number;
  meanDelta: number;
  /** Worst-offending grid cells, most-different first. */
  worstCells: GridCell[];
  diffPng: Buffer;
}

export interface CompareOptions {
  /** Per-channel 0-255 delta below which two pixels count as equal. */
  threshold?: number;
  gridCols?: number;
  gridRows?: number;
}

interface CompareInput {
  referenceUrl: string;
  candidateUrl: string;
  threshold: number;
  gridCols: number;
  gridRows: number;
}

async function compareInPage(input: CompareInput) {
  const { referenceUrl, candidateUrl, threshold, gridCols, gridRows } = input;

  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error(`decode failed: ${src.slice(0, 64)}`));
      img.src = src;
    });

  const pixels = (img: HTMLImageElement, w: number, h: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  };

  const [ref, cand] = await Promise.all([
    load(referenceUrl),
    load(candidateUrl),
  ]);
  const refW = ref.naturalWidth;
  const refH = ref.naturalHeight;
  const candW = cand.naturalWidth;
  const candH = cand.naturalHeight;

  // Compare the overlapping region only. Anything outside it is reported via
  // dimensionMismatch; stretching to fit would hide a real sizing error.
  const w = Math.min(refW, candW);
  const h = Math.min(refH, candH);
  const refData = pixels(ref, refW, refH);
  const candData = pixels(cand, candW, candH);

  const out = document.createElement("canvas");
  out.width = refW;
  out.height = refH;
  const outCtx = out.getContext("2d")!;
  outCtx.drawImage(ref, 0, 0);
  const overlay = outCtx.getImageData(0, 0, refW, refH);
  const o = overlay.data;
  // Dim the reference so diff pixels read clearly on top of it.
  for (let i = 0; i < o.length; i += 4) {
    o[i] = 32 + o[i] * 0.18;
    o[i + 1] = 32 + o[i + 1] * 0.18;
    o[i + 2] = 32 + o[i + 2] * 0.18;
  }

  const cellW = Math.max(1, Math.ceil(w / gridCols));
  const cellH = Math.max(1, Math.ceil(h / gridRows));
  const cellDiff = new Float64Array(gridCols * gridRows);
  const cellSum = new Float64Array(gridCols * gridRows);
  const cellCount = new Float64Array(gridCols * gridRows);

  let diffPixels = 0;
  let maxDelta = 0;
  let deltaSum = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ri = (y * refW + x) * 4;
      const ci = (y * candW + x) * 4;
      // Composite both against the same ground so a transparent pixel and an
      // identically-coloured opaque pixel are not treated as equal.
      const ra = refData[ri + 3] / 255;
      const ca = candData[ci + 3] / 255;
      const dr = Math.abs(refData[ri] * ra - candData[ci] * ca);
      const dg = Math.abs(refData[ri + 1] * ra - candData[ci + 1] * ca);
      const db = Math.abs(refData[ri + 2] * ra - candData[ci + 2] * ca);
      const da = Math.abs(refData[ri + 3] - candData[ci + 3]);
      const delta = Math.max(dr, dg, db, da);

      deltaSum += delta;
      if (delta > maxDelta) maxDelta = delta;

      const cell =
        Math.min(gridRows - 1, (y / cellH) | 0) * gridCols +
        Math.min(gridCols - 1, (x / cellW) | 0);
      cellSum[cell] += delta;
      cellCount[cell] += 1;

      if (delta > threshold) {
        diffPixels++;
        cellDiff[cell] += 1;
        o[ri] = 255;
        o[ri + 1] = 40;
        o[ri + 2] = 90;
        o[ri + 3] = 255;
      }
    }
  }

  // Area outside the overlap gets a distinct colour so a size mismatch shows up
  // in the artifact, not only in the numbers.
  for (let y = 0; y < refH; y++) {
    for (let x = 0; x < refW; x++) {
      if (x < w && y < h) continue;
      const oi = (y * refW + x) * 4;
      o[oi] = 255;
      o[oi + 1] = 190;
      o[oi + 2] = 0;
      o[oi + 3] = 255;
    }
  }
  outCtx.putImageData(overlay, 0, 0);

  const cells: GridCell[] = [];
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const idx = row * gridCols + col;
      if (!cellCount[idx]) continue;
      cells.push({
        col,
        row,
        x: col * cellW,
        y: row * cellH,
        width: Math.min(cellW, w - col * cellW),
        height: Math.min(cellH, h - row * cellH),
        diffRatio: cellDiff[idx] / cellCount[idx],
        meanDelta: cellSum[idx] / cellCount[idx],
      });
    }
  }
  cells.sort((a, b) => b.diffRatio - a.diffRatio || b.meanDelta - a.meanDelta);

  return {
    reference: { width: refW, height: refH },
    candidate: { width: candW, height: candH },
    dimensionMismatch: refW !== candW || refH !== candH,
    diffPixels,
    comparedPixels: w * h,
    diffRatio: diffPixels / (w * h),
    maxDelta,
    meanDelta: deltaSum / (w * h),
    worstCells: cells.slice(0, 24),
    diffDataUrl: out.toDataURL("image/png"),
  };
}

export async function comparePngs(
  browser: Browser,
  referencePng: Buffer,
  candidatePng: Buffer,
  options: CompareOptions = {},
): Promise<CompareResult> {
  const page = await browser.newPage();
  try {
    await page.setContent("<!doctype html><body></body>");
    // tsx/esbuild compiles this file with keepNames, which wraps every function
    // in a `__name(...)` call that does not exist inside the page. Defined as a
    // string so esbuild leaves it alone. addInitScript does not help here:
    // setContent on about:blank does not re-run init scripts.
    await page.evaluate("globalThis.__name ||= (fn) => fn;");
    const result = await page.evaluate(compareInPage, {
      referenceUrl: `data:image/png;base64,${referencePng.toString("base64")}`,
      candidateUrl: `data:image/png;base64,${candidatePng.toString("base64")}`,
      threshold: options.threshold ?? 8,
      gridCols: options.gridCols ?? 12,
      gridRows: options.gridRows ?? 12,
    });
    const { diffDataUrl, ...rest } = result;
    return {
      ...rest,
      diffPng: Buffer.from(diffDataUrl.split(",", 2)[1] ?? "", "base64"),
    };
  } finally {
    await page.close();
  }
}

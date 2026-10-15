/**
 * Hit mask for the camera bubble window while the person cut-out is on.
 *
 * The bubble window is a transparent rectangle, so without help its empty
 * pixels swallow clicks meant for the apps underneath. The bubble samples
 * the cut-out alpha onto a coarse grid over the whole window, adds the
 * visible controls, and hands the packed grid to Rust, which toggles
 * click-through as the cursor moves (`set_bubble_hit_mask`).
 */

/** Grid cell size in CSS pixels. */
export const HIT_MASK_CELL_PX = 6;
/** Alpha (0–255) a cell needs, after downsampling, to count as the person. */
export const HIT_MASK_ALPHA_THRESHOLD = 64;

export type HitMask = { cols: number; rows: number; bits: number[] };

/** A rectangle in CSS pixels relative to the window. */
export type HitRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function hitMaskGrid(
  width: number,
  height: number,
  cellPx = HIT_MASK_CELL_PX,
): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.ceil(width / cellPx)),
    rows: Math.max(1, Math.ceil(height / cellPx)),
  };
}

/**
 * Builds the packed mask (row-major, LSB first) from RGBA samples of the
 * cut-out drawn at grid resolution plus always-interactive rectangles.
 * Opaque cells are dilated by one cell so the edge of the person, where the
 * downsampled alpha fades, stays grabbable. When nobody is in frame,
 * `emptyFallback` keeps an area interactive so the bubble can still be
 * hovered and dragged.
 */
export function buildHitMask({
  cols,
  rows,
  rgba,
  rects = [],
  emptyFallback,
  cellPx = HIT_MASK_CELL_PX,
  threshold = HIT_MASK_ALPHA_THRESHOLD,
}: {
  cols: number;
  rows: number;
  rgba: ArrayLike<number> | null;
  rects?: HitRect[];
  emptyFallback?: HitRect;
  cellPx?: number;
  threshold?: number;
}): HitMask {
  const solid = new Uint8Array(cols * rows);
  let solidCount = 0;
  if (rgba) {
    for (let i = 0; i < cols * rows; i++) {
      if ((rgba[i * 4 + 3] ?? 0) >= threshold) {
        solid[i] = 1;
        solidCount++;
      }
    }
  }

  const hit = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!solid[y * cols + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= cols) continue;
          hit[ny * cols + nx] = 1;
        }
      }
    }
  }

  const interactive =
    solidCount === 0 && emptyFallback ? [...rects, emptyFallback] : rects;
  for (const rect of interactive) {
    const x0 = Math.max(0, Math.floor(rect.left / cellPx));
    const y0 = Math.max(0, Math.floor(rect.top / cellPx));
    const x1 = Math.min(cols, Math.ceil(rect.right / cellPx));
    const y1 = Math.min(rows, Math.ceil(rect.bottom / cellPx));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) hit[y * cols + x] = 1;
    }
  }

  const bits = new Array<number>(Math.ceil((cols * rows) / 8)).fill(0);
  for (let i = 0; i < hit.length; i++) {
    if (hit[i]) bits[i >> 3] |= 1 << (i & 7);
  }
  return { cols, rows, bits };
}

export function sameHitMask(a: HitMask | null, b: HitMask | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.cols !== b.cols || a.rows !== b.rows) return false;
  for (let i = 0; i < a.bits.length; i++) {
    if (a.bits[i] !== b.bits[i]) return false;
  }
  return true;
}

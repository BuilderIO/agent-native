/**
 * Geometry for cropping a screenshot to a dragged region.
 *
 * The user drags on a frozen capture that is scaled to fit the screen, so
 * every selection has to be translated from what they see back to the source
 * pixels before anything is cut. Keeping that arithmetic here — out of the
 * overlay component — is what makes it testable.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Smallest drag that counts as a selection rather than a stray click. */
export const MIN_SELECTION_PX = 8;

/** A drag runs in any direction; the rectangle it describes does not. */
export function rectFromPoints(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function isUsableSelection(
  rect: Rect | null,
  minSide = MIN_SELECTION_PX,
): boolean {
  if (!rect) return false;
  return rect.width >= minSide && rect.height >= minSide;
}

/**
 * Translate a rectangle drawn on the displayed (scaled) image into source
 * pixels, clamped to the image so a drag that runs off the edge crops to the
 * edge instead of asking for pixels that do not exist.
 */
export function mapRectToSource(
  rect: Rect,
  displayed: Size,
  source: Size,
): Rect | null {
  if (displayed.width <= 0 || displayed.height <= 0) return null;
  if (source.width <= 0 || source.height <= 0) return null;

  const scaleX = source.width / displayed.width;
  const scaleY = source.height / displayed.height;

  const left = clamp(Math.round(rect.x * scaleX), 0, source.width);
  const top = clamp(Math.round(rect.y * scaleY), 0, source.height);
  const right = clamp(
    Math.round((rect.x + rect.width) * scaleX),
    0,
    source.width,
  );
  const bottom = clamp(
    Math.round((rect.y + rect.height) * scaleY),
    0,
    source.height,
  );

  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1) return null;

  return { x: left, y: top, width, height };
}

export function cropCanvasToRect(
  source: HTMLCanvasElement,
  rect: Rect,
): HTMLCanvasElement {
  const cropped = document.createElement("canvas");
  cropped.width = rect.width;
  cropped.height = rect.height;
  const ctx = cropped.getContext("2d");
  if (!ctx) throw new Error("This browser could not crop the image.");
  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );
  return cropped;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * A single point on the displayed image, in source pixels, clamped to the
 * image. Not a 1x1 `mapRectToSource`: at the right or bottom edge that rect
 * has no width left after clamping and maps to nothing, which dropped any
 * arrow released there and froze a drag at the edge.
 */
export function mapPointToSource(
  point: { x: number; y: number },
  displayed: Size,
  source: Size,
): { x: number; y: number } | null {
  if (displayed.width <= 0 || displayed.height <= 0) return null;
  if (source.width <= 0 || source.height <= 0) return null;
  return {
    x: clamp(Math.round((point.x * source.width) / displayed.width), 0, source.width),
    y: clamp(Math.round((point.y * source.height) / displayed.height), 0, source.height),
  };
}

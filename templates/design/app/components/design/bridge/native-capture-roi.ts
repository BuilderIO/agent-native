export type NativeCaptureBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NativeCaptureRoi = {
  cssBox: NativeCaptureBox;
  pixelBox: NativeCaptureBox;
  pixelOffset: { x: number; y: number };
};

export type NativeCaptureRoiResult =
  | { ok: true; plan: NativeCaptureRoi }
  | { ok: false; reason: "invalid-geometry" | "capture-too-large" };

const capturePlans = new WeakMap<HTMLCanvasElement, NativeCaptureRoi>();

export function planNativeCaptureRoi(input: {
  ownBox: NativeCaptureBox;
  clipBox: NativeCaptureBox;
  density: number;
  maxDimension: number;
  maxPixels: number;
}): NativeCaptureRoiResult {
  const { ownBox, clipBox, density, maxDimension, maxPixels } = input;
  if (
    ![ownBox, clipBox].every(
      (box) =>
        [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
        box.width >= 0 &&
        box.height >= 0,
    ) ||
    !Number.isFinite(density) ||
    density <= 0 ||
    !Number.isSafeInteger(maxDimension) ||
    !Number.isSafeInteger(maxPixels) ||
    maxDimension <= 0 ||
    maxPixels <= 0
  )
    return { ok: false, reason: "invalid-geometry" };
  const x = Math.min(ownBox.x, clipBox.x);
  const y = Math.min(ownBox.y, clipBox.y);
  const right = Math.max(ownBox.x + ownBox.width, clipBox.x + clipBox.width);
  const bottom = Math.max(ownBox.y + ownBox.height, clipBox.y + clipBox.height);
  const leftPixel = Math.floor(x * density);
  const topPixel = Math.floor(y * density);
  const rightPixel = Math.ceil(right * density);
  const bottomPixel = Math.ceil(bottom * density);
  const width = rightPixel - leftPixel;
  const height = bottomPixel - topPixel;
  if (
    ![leftPixel, topPixel, rightPixel, bottomPixel, width, height].every(
      Number.isSafeInteger,
    ) ||
    width <= 0 ||
    height <= 0
  )
    return { ok: false, reason: "invalid-geometry" };
  if (
    width > maxDimension ||
    height > maxDimension ||
    width * height > maxPixels
  )
    return { ok: false, reason: "capture-too-large" };
  return {
    ok: true,
    plan: {
      cssBox: {
        x: leftPixel / density,
        y: topPixel / density,
        width: width / density,
        height: height / density,
      },
      pixelBox: {
        x: leftPixel,
        y: topPixel,
        width,
        height,
      },
      pixelOffset: { x: -leftPixel, y: -topPixel },
    },
  };
}

export function setNativeCaptureRoi(
  canvas: HTMLCanvasElement,
  plan: NativeCaptureRoi,
): void {
  capturePlans.set(canvas, plan);
}

export function nativeCaptureRoi(
  canvas: HTMLCanvasElement,
): NativeCaptureRoi | null {
  return capturePlans.get(canvas) ?? null;
}

export function planNativePhysicalRootBox(input: {
  width: number;
  height: number;
  left: number;
  top: number;
}): { ok: true; box: NativeCaptureBox } | { ok: false } {
  const { width, height, left, top } = input;
  if (
    ![width, height, left, top].every(Number.isSafeInteger) ||
    width <= 0 ||
    height <= 0 ||
    left < 0 ||
    top < 0 ||
    left >= width ||
    top >= height
  )
    return { ok: false };
  return { ok: true, box: { x: -left, y: -top, width, height } };
}

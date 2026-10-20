export interface NativePreviewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const NATIVE_PREVIEW_INSET_ATTRIBUTES = [
  "data-an-native-preview-inset-left",
  "data-an-native-preview-inset-right",
] as const;

export function readNativePreviewInsetClip(
  element: Element,
): NativePreviewBox | null {
  const raw = NATIVE_PREVIEW_INSET_ATTRIBUTES.map((name) =>
    element.getAttribute(name),
  );
  if (raw.every((value) => value === null)) return null;
  const insets = raw.map((value) => {
    if (value === null) return 0;
    const parsed = Number(value);
    if (!value.trim() || !Number.isFinite(parsed) || parsed < 0)
      throw new RangeError("The editor preview inset is unreadable.");
    return parsed;
  });
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + insets[0]!,
    y: rect.top,
    width: Math.max(0, rect.width - insets[0]! - insets[1]!),
    height: rect.height,
  };
}

export function nativePreviewBoxesOverlap(
  first: NativePreviewBox,
  second: NativePreviewBox,
): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  );
}

export function nativePreviewTargetDensity(input: {
  baseDensity: number;
  displayScale: number;
  viewport: NativePreviewBox | null;
  target: NativePreviewBox;
}): number {
  return input.baseDensity * (input.viewport ? input.displayScale : 1);
}

export function fitNativeRasterDensity(input: {
  width: number;
  height: number;
  density: number;
  maxDimension: number;
  maxPixels: number;
  pixelPadding?: number;
}): number {
  const { width, height, density, maxDimension, maxPixels } = input;
  const padding = input.pixelPadding ?? 0;
  if (
    ![width, height, density, maxDimension, maxPixels].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw new RangeError("Invalid native raster density geometry.");
  if (
    !Number.isSafeInteger(padding) ||
    padding < 0 ||
    padding >= maxDimension ||
    (padding + 1) ** 2 > maxPixels
  )
    throw new RangeError("Invalid native raster density padding.");
  const fits = (ratio: number): boolean => {
    const w = Math.ceil(width * ratio) + padding;
    const h = Math.ceil(height * ratio) + padding;
    return w <= maxDimension && h <= maxDimension && w * h <= maxPixels;
  };
  if (fits(density)) return density;
  let lower = 0;
  let upper = Math.min(
    density,
    (maxDimension - padding) / width,
    (maxDimension - padding) / height,
    (Math.sqrt(maxPixels) - padding) / Math.sqrt(width) / Math.sqrt(height),
  );
  if (fits(upper)) return upper;
  for (let i = 0; i < 40; i += 1) {
    const middle = (lower + upper) / 2;
    if (fits(middle)) lower = middle;
    else upper = middle;
  }
  return lower;
}

export function planNativePreviewViewport(input: {
  width: number;
  height: number;
  display: NativePreviewBox;
  clips: readonly NativePreviewBox[];
}): { scale: number; viewport: NativePreviewBox } | null {
  const { width, height, display, clips } = input;
  if (
    ![width, height, display.width, display.height].every(
      (n) => Number.isFinite(n) && n > 0,
    ) ||
    ![
      display.x,
      display.y,
      ...clips.flatMap((box) => [box.x, box.y, box.width, box.height]),
    ].every(Number.isFinite)
  )
    throw new RangeError("Invalid native preview viewport geometry.");
  const scaleX = display.width / width;
  const scaleY = display.height / height;
  let left = display.x;
  let top = display.y;
  let right = left + display.width;
  let bottom = top + display.height;
  for (const clip of clips) {
    left = Math.max(left, clip.x);
    top = Math.max(top, clip.y);
    right = Math.min(right, clip.x + clip.width);
    bottom = Math.min(bottom, clip.y + clip.height);
  }
  if (right <= left || bottom <= top) return null;
  return {
    scale: Math.max(scaleX, scaleY),
    viewport: {
      x: Math.max(0, (left - display.x) / scaleX),
      y: Math.max(0, (top - display.y) / scaleY),
      width: (right - left) / scaleX,
      height: (bottom - top) / scaleY,
    },
  };
}

export function nativePreviewPhysicalViewport(
  viewport: NativePreviewBox,
  density: number,
): NativePreviewBox {
  if (
    ![viewport.x, viewport.y, viewport.width, viewport.height, density].every(
      Number.isFinite,
    ) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    density <= 0
  )
    throw new RangeError("Invalid native preview physical viewport.");
  const x = Math.floor(viewport.x * density);
  const y = Math.floor(viewport.y * density);
  return {
    x,
    y,
    width: Math.ceil((viewport.x + viewport.width) * density) - x,
    height: Math.ceil((viewport.y + viewport.height) * density) - y,
  };
}

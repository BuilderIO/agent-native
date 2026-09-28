export interface ScreenAxisSizeConstraints {
  min: number | null;
  max: number | null;
}

export interface ScreenSizeConstraints {
  width: ScreenAxisSizeConstraints;
  height: ScreenAxisSizeConstraints;
}

export interface FrameSizeBounds {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

export function readScreenSizeConstraints(
  styles: Record<string, string> | undefined,
): ScreenSizeConstraints {
  return {
    width: {
      min: parseComputedPixelLength(styles?.minWidth),
      max: parseComputedPixelLength(styles?.maxWidth),
    },
    height: {
      min: parseComputedPixelLength(styles?.minHeight),
      max: parseComputedPixelLength(styles?.maxHeight),
    },
  };
}

export function screenSizeConstraintsToFrameBounds(
  constraints: ScreenSizeConstraints,
): FrameSizeBounds {
  const bounds: FrameSizeBounds = {};
  const widthMin = Math.max(1, constraints.width.min ?? 0);
  const heightMin = Math.max(1, constraints.height.min ?? 0);
  if (constraints.width.min != null || constraints.width.max != null) {
    bounds.minWidth = widthMin;
  }
  if (constraints.width.max != null) {
    bounds.maxWidth = Math.max(widthMin, constraints.width.max);
  }
  if (constraints.height.min != null || constraints.height.max != null) {
    bounds.minHeight = heightMin;
  }
  if (constraints.height.max != null) {
    bounds.maxHeight = Math.max(heightMin, constraints.height.max);
  }
  return bounds;
}

export function clampScreenDimension(
  value: number,
  axis: "width" | "height",
  constraints: ScreenSizeConstraints,
): number {
  const { min, max } = constraints[axis];
  const lowerBound = min == null ? 1 : Math.max(1, min);
  const upperBound =
    max == null ? Number.POSITIVE_INFINITY : Math.max(lowerBound, max);
  return Math.min(upperBound, Math.max(lowerBound, value));
}

export function clampScreenFrameSize<
  T extends { width: number; height: number },
>(geometry: T, constraints: ScreenSizeConstraints): T {
  return {
    ...geometry,
    width: clampScreenDimension(geometry.width, "width", constraints),
    height: clampScreenDimension(geometry.height, "height", constraints),
  };
}

function parseComputedPixelLength(value: string | undefined): number | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "auto") {
    return null;
  }
  const match = normalized.match(/^(-?(?:\d+\.?\d*|\.\d+))(?:px)?$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

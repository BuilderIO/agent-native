/**
 * Geometry of one screen's responsive frame group: the primary frame plus the
 * breakpoint previews painted to its right.
 *
 * This lives in `shared/` because both sides of the contract need it. Actions
 * that place screens on the overview board must reserve the same footprint the
 * canvas paints, or another screen can land underneath a breakpoint preview.
 */

/** Gap between the primary frame and each breakpoint preview beside it. */
export const BREAKPOINT_FRAME_GAP = 24;

export const MAX_SANE_FRAME_DIMENSION_PX = 100_000;

/**
 * Extra screen-constant gap between the last breakpoint card (or primary) and
 * the circular "+" add-breakpoint affordance. Multiplied by `chromeScale` so it
 * stays readable at every zoom; without this the chrome-scaled button can sit
 * flush against the frame edge.
 */
export const BREAKPOINT_ADD_BUTTON_GAP_PX = 16;

/** Drops any breakpoint whose width equals the primary frame's own width — a
 * redundant duplicate of the base — also cleaning up designs authored before
 * the default set excluded the primary width. */
export function visibleBreakpointWidths(
  breakpointWidths: readonly number[] | undefined,
  primaryWidthPx: number | undefined,
): number[] {
  const deduped = Array.from(
    new Set(
      (breakpointWidths ?? []).filter(
        (width) => Number.isFinite(width) && width > 0,
      ),
    ),
  );
  if (primaryWidthPx === undefined || !Number.isFinite(primaryWidthPx)) {
    return deduped;
  }
  return deduped.filter((width) => Math.abs(width - primaryWidthPx) > 1);
}

/**
 * Shared because the renderer, placement, and culling must agree whether the
 * primary frame scales its source viewport or reflows to its own aspect ratio.
 */
export function getScreenPreviewViewport(
  metadata: { width: number; height: number },
  geometry: { width: number; height: number },
) {
  const metadataWidth = Math.max(1, Math.round(metadata.width));
  const metadataHeight = Math.max(1, Math.round(metadata.height));
  const geometryWidth = Math.max(1, Math.round(geometry.width));
  const geometryHeight = Math.max(1, Math.round(geometry.height));
  const metadataAspect = metadataWidth / metadataHeight;
  const geometryAspect = geometryWidth / geometryHeight;
  const aspectMatches = Math.abs(metadataAspect - geometryAspect) < 0.005;

  if (aspectMatches) {
    return {
      viewportWidth: metadataWidth,
      viewportHeight: metadataHeight,
      displayWidth: metadataWidth,
      displayHeight: metadataHeight,
      scale:
        Math.abs(metadataWidth - geometryWidth) < 0.5 &&
        Math.abs(metadataHeight - geometryHeight) < 0.5
          ? 1
          : geometryWidth / metadataWidth,
    };
  }

  return {
    viewportWidth: geometryWidth,
    viewportHeight: geometryHeight,
    displayWidth: geometryWidth,
    displayHeight: geometryHeight,
    scale: 1,
  };
}

/** Rotates the right-extended preview group around its primary frame center. */
export function getResponsiveGroupRotatedBounds({
  x,
  y,
  primaryWidth,
  primaryHeight,
  groupWidth,
  groupHeight,
  rotation,
}: {
  x: number;
  y: number;
  primaryWidth: number;
  primaryHeight: number;
  groupWidth: number;
  groupHeight: number;
  rotation: number;
}): { x: number; y: number; width: number; height: number } {
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const pivotX = x + primaryWidth / 2;
  const pivotY = y + primaryHeight / 2;
  const corners = [
    { x, y },
    { x: x + groupWidth, y },
    { x, y: y + groupHeight },
    { x: x + groupWidth, y: y + groupHeight },
  ].map((point) => {
    const dx = point.x - pivotX;
    const dy = point.y - pivotY;
    return {
      x: pivotX + dx * cosine - dy * sine,
      y: pivotY + dx * sine + dy * cosine,
    };
  });
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function getResponsiveBreakpointWidths(value: unknown): number[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const breakpoints = (value as Record<string, unknown>).breakpoints;
  if (!Array.isArray(breakpoints)) return [];
  return breakpoints.flatMap((breakpoint) => {
    if (
      !breakpoint ||
      typeof breakpoint !== "object" ||
      Array.isArray(breakpoint)
    ) {
      return [];
    }
    const widthPx = (breakpoint as Record<string, unknown>).widthPx;
    return typeof widthPx === "number" &&
      Number.isFinite(widthPx) &&
      widthPx > 0
      ? [widthPx]
      : [];
  });
}

export function getResponsiveBreakpointHeightPx(
  metadata: unknown,
  widthPx: number,
): number | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const heights = (metadata as Record<string, unknown>).breakpointHeights;
  if (!heights || typeof heights !== "object" || Array.isArray(heights)) {
    return undefined;
  }
  const height = (heights as Record<string, unknown>)[String(widthPx)];
  return typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0 &&
    height <= MAX_SANE_FRAME_DIMENSION_PX
    ? height
    : undefined;
}

/** The renderer's fallback height for an unmeasured responsive preview. */
export function deviceViewportFloorForWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 640) return 844;
  if (widthPx <= 1024) return 1024;
  return 900;
}

/**
 * Total painted width of a screen's frame group: the primary box plus every
 * breakpoint preview beside it, each drawn at the primary's own uniform
 * `scale`. `visibleWidths` must already be filtered through
 * `visibleBreakpointWidths` — callers differ in which width they dedupe
 * against, but the arithmetic must not.
 */
export function getResponsiveGroupWidth({
  primaryWidth,
  scale,
  visibleWidths,
}: {
  primaryWidth: number;
  scale: number;
  visibleWidths: readonly number[];
}): number {
  return visibleWidths.reduce(
    (total, width) => total + BREAKPOINT_FRAME_GAP + width * scale,
    Math.max(1, primaryWidth),
  );
}

/** Total painted height of a screen's primary and responsive frames. */
export function getResponsiveGroupHeight({
  primaryHeight,
  scale,
  sourceWidth,
  sourceHeight,
  visibleWidths,
  resolveBreakpointHeightPx,
}: {
  primaryHeight: number;
  scale: number;
  sourceWidth: number;
  sourceHeight: number;
  visibleWidths: readonly number[];
  resolveBreakpointHeightPx?: (widthPx: number) => number | undefined;
}): number {
  const naturalWidth = Math.max(1, sourceWidth);
  const naturalHeight = Math.max(1, sourceHeight);
  return Math.max(
    Math.max(1, primaryHeight),
    ...visibleWidths.map((widthPx) => {
      const measured = resolveBreakpointHeightPx?.(widthPx);
      const frameHeight =
        measured && measured > 0
          ? Math.max(deviceViewportFloorForWidth(widthPx), measured)
          : (widthPx * naturalHeight) / naturalWidth;
      return frameHeight * scale;
    }),
  );
}

import type { CSSProperties } from "react";

import type { FrameGeometry } from "./types";
import type { Point } from "./types";

export const OVERVIEW_FRAME_WIDTH = 320;
export const SURFACE_PADDING = 240;

// Chromium does not reliably paint the far interior of the old
// 131,072×131,072 board iframe. Keep the logical board that large for
// persistence and hit testing, but render only a stable, chunk-snapped window
// around the current design. Four-kilopixel chunks plus two chunks of minimum
// extent leave ample room for nearby drawing/movement without re-keying the
// iframe on every small edit.
export const BOARD_SURFACE_RENDER_CHUNK = 4096;
export const BOARD_SURFACE_RENDER_PADDING = 2048;
export const BOARD_SURFACE_RENDER_MIN_SIZE = 8192;
export const BOARD_SURFACE_RENDER_MAX_SIZE = 24_576;
export const BOARD_SURFACE_STATIC_PREVIEW_SIZE = 4096;

export const LINEUP_RECENTER_SUPPRESS_MAX_AGE_MS = 10_000;

export interface LineupRecenterDuplicateArm {
  atMs: number;
  fromCount: number;
  addedCount: number;
}

/** An explicit bounds-fit command owns the next camera commit. The automatic
 * screen-count lineup recenter must stand down until that nonce is handled or
 * it can briefly paint the all-screens camera before the requested target fit. */
export function shouldDeferLineupRecenterToCameraCommand(args: {
  cameraCommandNonce?: number;
  lastHandledCameraCommandNonce: number | null;
}): boolean {
  return (
    args.cameraCommandNonce !== undefined &&
    args.cameraCommandNonce !== args.lastHandledCameraCommandNonce
  );
}

export function shouldSuppressLineupRecenter(args: {
  armed: LineupRecenterDuplicateArm | null;
  nowMs: number;
  screenCount: number;
  deviceFrameChanged: boolean;
  maxAgeMs?: number;
}): boolean {
  if (!args.armed) return false;
  if (args.deviceFrameChanged) return false;
  const age = args.nowMs - args.armed.atMs;
  if (age < 0 || age > (args.maxAgeMs ?? LINEUP_RECENTER_SUPPRESS_MAX_AGE_MS)) {
    return false;
  }
  return (
    args.screenCount > args.armed.fromCount && // i18n-ignore -- comparison, not visible copy
    args.screenCount <= args.armed.fromCount + args.armed.addedCount
  );
}

export function isLineupShrinkOnlyChange(args: {
  previousCount: number | null;
  screenCount: number;
  deviceFrameChanged: boolean;
}): boolean {
  return (
    !args.deviceFrameChanged &&
    args.previousCount !== null &&
    args.screenCount < args.previousCount
  );
}

export function getBoardSurfaceLayerStyle(args: {
  geometry: FrameGeometry;
  interactive: boolean;
}): CSSProperties {
  return {
    position: "absolute",
    left: SURFACE_PADDING + args.geometry.x,
    top: SURFACE_PADDING + args.geometry.y,
    width: args.geometry.width,
    height: args.geometry.height,
    overflow: "hidden",
    pointerEvents: args.interactive ? "auto" : "none",
    background: "transparent",
    zIndex: 0,
  };
}

/**
 * The interactive board iframe intentionally stays below Chromium's reliable
 * paint limit. At very low zoom the visible world can be wider than that
 * window, so a script-disabled static replica supplies visual coverage behind
 * it. Keep the fallback off at ordinary zoom where the live window already
 * covers the viewport.
 */
export function shouldRenderBoardSurfaceStaticPreview(args: {
  zoom: number;
  viewportGeometry?: FrameGeometry | null;
  renderGeometry: FrameGeometry;
}) {
  if (args.viewportGeometry) {
    return (
      args.viewportGeometry.width > args.renderGeometry.width ||
      args.viewportGeometry.height > args.renderGeometry.height
    );
  }
  // ResizeObserver has not reported yet. The 5% fallback matches a 1229px
  // viewport against the 24,576-world-pixel live cap and avoids one blank
  // first paint at the minimum 2% zoom.
  return args.zoom <= 5;
}

export function getBoardSurfaceStaticPreviewViewport(
  logicalGeometry: FrameGeometry,
) {
  const longestAxis = Math.max(
    1,
    logicalGeometry.width,
    logicalGeometry.height,
  );
  const scale = Math.min(1, BOARD_SURFACE_STATIC_PREVIEW_SIZE / longestAxis);
  return {
    width: Math.max(1, logicalGeometry.width * scale),
    height: Math.max(1, logicalGeometry.height * scale),
  };
}

function geometryExtent(geometry: FrameGeometry) {
  return {
    minX: geometry.x,
    minY: geometry.y,
    maxX: geometry.x + Math.max(1, geometry.width),
    maxY: geometry.y + Math.max(1, geometry.height),
  };
}

function fitRenderAxis(args: {
  desiredMin: number;
  desiredMax: number;
  logicalMin: number;
  logicalMax: number;
  focus: number;
}) {
  const chunk = BOARD_SURFACE_RENDER_CHUNK;
  const logicalSize = Math.max(1, args.logicalMax - args.logicalMin);
  const maxSize = Math.min(BOARD_SURFACE_RENDER_MAX_SIZE, logicalSize);
  const minSize = Math.min(BOARD_SURFACE_RENDER_MIN_SIZE, maxSize);
  let min =
    Math.floor((args.desiredMin - BOARD_SURFACE_RENDER_PADDING) / chunk) *
    chunk;
  let max =
    Math.ceil((args.desiredMax + BOARD_SURFACE_RENDER_PADDING) / chunk) * chunk;

  if (max - min < minSize) {
    const center = (min + max) / 2;
    min = Math.floor((center - minSize / 2) / chunk) * chunk;
    max = min + minSize;
  }

  if (max - min > maxSize) {
    // A single browser iframe cannot safely cover arbitrarily distant board
    // islands. Prefer the active design focus while keeping the render window
    // chunk-aligned; persistence and geometry hit testing still use the full
    // logical board and remain lossless.
    min = Math.floor((args.focus - maxSize / 2) / chunk) * chunk;
    max = min + maxSize;
  }

  if (min < args.logicalMin) {
    max += args.logicalMin - min;
    min = args.logicalMin;
  }
  if (max > args.logicalMax) {
    min -= max - args.logicalMax;
    max = args.logicalMax;
  }
  min = Math.max(args.logicalMin, min);
  max = Math.min(args.logicalMax, Math.max(min + 1, max));
  return { origin: min, size: max - min };
}

/**
 * Builds the finite iframe window used to paint the otherwise-infinite board.
 * The returned geometry is deliberately separate from the logical board
 * geometry so persisted coordinates and broad hit-testing retain their full
 * range while Chromium only has to paint a browser-safe surface.
 */
export function getBoardSurfaceRenderGeometry(args: {
  logicalGeometry: FrameGeometry;
  contentBounds?: FrameGeometry | null;
  screenGeometries?: readonly FrameGeometry[];
  focus?: { x: number; y: number };
}): FrameGeometry {
  const candidates = [
    ...(args.contentBounds ? [args.contentBounds] : []),
    ...(args.screenGeometries ?? []),
  ];
  const logical = geometryExtent(args.logicalGeometry);
  const extents = candidates.map(geometryExtent);
  const desired =
    extents.length > 0
      ? {
          minX: Math.min(...extents.map((extent) => extent.minX)),
          minY: Math.min(...extents.map((extent) => extent.minY)),
          maxX: Math.max(...extents.map((extent) => extent.maxX)),
          maxY: Math.max(...extents.map((extent) => extent.maxY)),
        }
      : {
          minX: 0,
          minY: 0,
          maxX: 1,
          maxY: 1,
        };
  const focus = args.focus ?? {
    x: (desired.minX + desired.maxX) / 2,
    y: (desired.minY + desired.maxY) / 2,
  };
  const xAxis = fitRenderAxis({
    desiredMin: desired.minX,
    desiredMax: desired.maxX,
    logicalMin: logical.minX,
    logicalMax: logical.maxX,
    focus: focus.x,
  });
  const yAxis = fitRenderAxis({
    desiredMin: desired.minY,
    desiredMax: desired.maxY,
    logicalMin: logical.minY,
    logicalMax: logical.maxY,
    focus: focus.y,
  });
  return {
    x: xAxis.origin,
    y: yAxis.origin,
    width: xAxis.size,
    height: yAxis.size,
  };
}

export function boardPointToBoardSurfaceLocalPoint(
  point: Point,
  renderGeometry: FrameGeometry,
): Point {
  return {
    x: point.x - renderGeometry.x,
    y: point.y - renderGeometry.y,
  };
}

export function boardSurfaceLocalPointToBoardPoint(
  point: Point,
  renderGeometry: FrameGeometry,
): Point {
  return {
    x: renderGeometry.x + point.x,
    y: renderGeometry.y + point.y,
  };
}

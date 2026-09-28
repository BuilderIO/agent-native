import { getRotatedFrameAABB, type FrameBounds } from "@shared/canvas-math";
import type { CSSProperties } from "react";

import type { FrameGeometry } from "./types";
import type { Point } from "./types";

export const OVERVIEW_FRAME_WIDTH = 320;
export const SURFACE_PADDING = 240;

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
    overflow: "clip",
    pointerEvents: args.interactive ? "auto" : "none",
    background: "transparent",
    zIndex: 0,
  };
}

export function shouldRenderBoardSurfaceStaticPreview(args: {
  zoom: number;
  hasSurfaceContent: boolean;
  viewportGeometry?: FrameGeometry | null;
  renderGeometry: FrameGeometry;
}) {
  if (!args.hasSurfaceContent) return false;
  if (!args.viewportGeometry) return false;
  return (
    args.viewportGeometry.width > args.renderGeometry.width ||
    args.viewportGeometry.height > args.renderGeometry.height
  );
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

export function getBoardSurfaceStaticPreviewClip(args: {
  logicalGeometry: FrameGeometry;
  viewportGeometry?: FrameGeometry | null;
}) {
  const { logicalGeometry, viewportGeometry } = args;
  if (!viewportGeometry) return undefined;

  const width = Math.max(1, logicalGeometry.width);
  const height = Math.max(1, logicalGeometry.height);
  const left = Math.min(
    width,
    Math.max(0, viewportGeometry.x - logicalGeometry.x),
  );
  const top = Math.min(
    height,
    Math.max(0, viewportGeometry.y - logicalGeometry.y),
  );
  const right = Math.min(
    width,
    Math.max(
      0,
      logicalGeometry.x + width - (viewportGeometry.x + viewportGeometry.width),
    ),
  );
  const bottom = Math.min(
    height,
    Math.max(
      0,
      logicalGeometry.y +
        height -
        (viewportGeometry.y + viewportGeometry.height),
    ),
  );

  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

export function getBoardSurfaceStaticPreviewTransform(args: {
  logicalGeometry: FrameGeometry;
  viewport: { width: number; height: number };
  pan: Point;
  zoom: number;
}) {
  const { logicalGeometry, viewport, pan, zoom } = args;
  const scale = zoom / 100;
  const x = pan.x + (SURFACE_PADDING + logicalGeometry.x) * scale;
  const y = pan.y + (SURFACE_PADDING + logicalGeometry.y) * scale;
  return `translate(${x}px, ${y}px) scale(${(logicalGeometry.width / viewport.width) * scale}, ${(logicalGeometry.height / viewport.height) * scale})`;
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

export function getBoardSurfaceRenderGeometry(args: {
  logicalGeometry: FrameGeometry;
  contentBounds?: FrameGeometry | null;
  screenGeometries?: readonly FrameGeometry[];
  focus?: { x: number; y: number };
}): FrameGeometry {
  const [onlyVisibleGeometry] = args.screenGeometries ?? [];
  if (
    !args.contentBounds &&
    args.screenGeometries?.length === 1 &&
    args.focus &&
    onlyVisibleGeometry &&
    args.focus.x === onlyVisibleGeometry.x + onlyVisibleGeometry.width / 2 &&
    args.focus.y === onlyVisibleGeometry.y + onlyVisibleGeometry.height / 2
  ) {
    return onlyVisibleGeometry;
  }

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

export function getBoardSelectionWorldBounds(args: {
  rect: { left: number; top: number; width: number; height: number };
  rotationDeg?: number;
  contentOffsetX: number;
  contentOffsetY: number;
}): FrameBounds {
  const origin = boardSurfaceLocalPointToBoardPoint(
    { x: args.rect.left, y: args.rect.top },
    {
      x: -args.contentOffsetX,
      y: -args.contentOffsetY,
      width: args.rect.width,
      height: args.rect.height,
    },
  );
  return getRotatedFrameAABB({
    ...origin,
    width: args.rect.width,
    height: args.rect.height,
    rotation: args.rotationDeg ?? 0,
  });
}

export function getCurrentBoardSelectionWorldBounds(args: {
  selection: {
    screenId: string;
    selector: string;
    memberSelectors?: readonly string[];
    memberSourceIds?: readonly string[];
    worldBounds: FrameBounds;
  } | null;
  boardFileId?: string | null;
  ownerFileId?: string | null;
  selectedLayerId?: string;
  sourceLayerIdentity?: { screenId: string; nodeId: string };
  currentSelectors: readonly string[];
  currentSourceIds?: readonly string[];
}): FrameBounds | null {
  const { selection, boardFileId, ownerFileId, selectedLayerId } = args;
  if (
    !selection ||
    !boardFileId ||
    ownerFileId !== boardFileId ||
    selection.screenId !== ownerFileId ||
    args.sourceLayerIdentity?.screenId !== ownerFileId ||
    !selectedLayerId ||
    args.sourceLayerIdentity.nodeId !== selectedLayerId
  ) {
    return null;
  }
  if (selection.memberSourceIds) {
    const currentSourceIds = args.currentSourceIds ?? [];
    const unmatched = [...selection.memberSourceIds];
    if (
      currentSourceIds.length !== unmatched.length ||
      new Set(unmatched).size !== unmatched.length ||
      new Set(currentSourceIds).size !== currentSourceIds.length
    ) {
      return null;
    }
    for (const sourceId of currentSourceIds) {
      const match = unmatched.indexOf(sourceId);
      if (match === -1) return null;
      unmatched.splice(match, 1);
    }
    return unmatched.length === 0 ? selection.worldBounds : null;
  }
  if (
    (args.currentSourceIds?.length ?? 0) > 1 ||
    !args.currentSelectors.includes(selection.selector)
  ) {
    return null;
  }
  return selection.worldBounds;
}

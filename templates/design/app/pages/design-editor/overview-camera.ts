import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import {
  CANVAS_FIT_PADDING_PX,
  DEFAULT_CANVAS_MAX_ZOOM,
  DEFAULT_CANVAS_MIN_ZOOM,
  getCameraForBounds,
  getFrameGroupBounds,
  type FrameEntry,
} from "@shared/canvas-math";
import type { SetStateAction } from "react";

import {
  getInitialFrameGeometry,
  getResponsiveScreenCullGeometry,
} from "@/components/design/multi-screen/frame-geometry";
import { OVERVIEW_FRAME_WIDTH } from "@/components/design/multi-screen/overview-layout";
import type {
  FrameGeometry,
  Point,
} from "@/components/design/multi-screen/types";

export const DEFAULT_OVERVIEW_ZOOM = 60;

export function getScreenFrameOriginCanvas(args: {
  screenId: string;
  overviewScreens: Array<{
    id: string;
    width?: number;
    height?: number;
  }>;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  boardFileId?: string | null;
}): Point | null {
  if (args.boardFileId && args.screenId === args.boardFileId) {
    return { x: 0, y: 0 };
  }
  const screenIndex = args.overviewScreens.findIndex(
    (screen) => screen.id === args.screenId,
  );
  if (screenIndex < 0) return null;
  const screen = args.overviewScreens[screenIndex];
  if (!screen) return null;
  const fallbackGeometry = getInitialFrameGeometry(screenIndex, {
    width: screen.width ?? 1280,
    height: screen.height ?? 2560,
  });
  const persistedGeometry = args.canvasFrameGeometryById[args.screenId] ?? {};
  return {
    x: persistedGeometry.x ?? fallbackGeometry.x,
    y: persistedGeometry.y ?? fallbackGeometry.y,
  };
}

export function getBoardSelectionFitBounds(args: {
  selectedFrameEntries: readonly FrameEntry[];
  selectedScreenIds: ReadonlySet<string>;
  boardFileId: string;
  boardBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}) {
  const selectedScreens = args.selectedFrameEntries.filter(
    (frame) =>
      frame.id !== args.boardFileId && args.selectedScreenIds.has(frame.id),
  );
  return getFrameGroupBounds([
    ...selectedScreens,
    {
      id: args.boardFileId,
      geometry: {
        x: args.boardBounds.left,
        y: args.boardBounds.top,
        width: args.boardBounds.width,
        height: args.boardBounds.height,
      },
    },
  ]);
}

export function getAllScreenFrameEntries(args: {
  overviewScreens: Array<{
    id: string;
    width?: number;
    height?: number;
    breakpointWidths?: readonly number[];
    breakpointHeights?: Record<string, number>;
  }>;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  boardContentBounds?: FrameGeometry | null;
  boardFileId?: string | null;
  includeResponsivePreviews?: boolean;
}): FrameEntry[] {
  const entries: FrameEntry[] = args.overviewScreens.map((screen, index) => {
    const fallbackGeometry = getInitialFrameGeometry(index, {
      width: screen.width ?? 1280,
      height: screen.height ?? 2560,
    });
    const persistedGeometry = args.canvasFrameGeometryById[screen.id] ?? {};
    const primaryGeometry = { ...fallbackGeometry, ...persistedGeometry };
    return {
      id: screen.id,
      geometry: args.includeResponsivePreviews
        ? getResponsiveScreenCullGeometry(
            {
              id: screen.id,
              metadata: {
                width: screen.width ?? 1280,
                height: screen.height ?? 2560,
              },
              breakpointWidths: screen.breakpointWidths,
            },
            primaryGeometry,
            (widthPx) => screen.breakpointHeights?.[String(widthPx)],
          )
        : primaryGeometry,
    };
  });
  if (
    args.boardFileId &&
    args.boardContentBounds &&
    !entries.some((entry) => entry.id === args.boardFileId)
  ) {
    entries.push({ id: args.boardFileId, geometry: args.boardContentBounds });
  }
  return entries;
}

export function pinnedHeightScreenIds(
  overviewScreens: ReadonlyArray<{ id: string; heightPinned?: boolean }>,
): ReadonlySet<string> {
  return new Set(
    overviewScreens
      .filter((screen) => screen.heightPinned)
      .map((screen) => screen.id),
  );
}

export function autoHeightScreenIds(
  overviewScreens: ReadonlyArray<{
    id: string;
    heightMode?: "auto" | "fixed" | "hug";
  }>,
): ReadonlySet<string> {
  return new Set(
    overviewScreens
      .filter(
        (screen) =>
          screen.heightMode !== "fixed" && screen.heightMode !== "hug",
      )
      .map((screen) => screen.id),
  );
}

export function withMeasuredFrameHeights(
  frames: FrameEntry[],
  measuredHeightById: Record<string, number>,
  pinnedHeightIds: ReadonlySet<string>,
  autoHeightIds: ReadonlySet<string>,
): FrameEntry[] {
  if (Object.keys(measuredHeightById).length === 0) return frames;
  return frames.map((frame) => {
    if (pinnedHeightIds.has(frame.id) || !autoHeightIds.has(frame.id)) {
      return frame;
    }
    const measured = measuredHeightById[frame.id];
    if (!measured || measured <= (frame.geometry.height ?? 0)) return frame;
    return { ...frame, geometry: { ...frame.geometry, height: measured } };
  });
}

export function findScreenFrameAtCanvasPoint(
  point: { x: number; y: number },
  frames: FrameEntry[],
  excludeFileId?: string | null,
): FrameEntry | null {
  let match: FrameEntry | null = null;
  for (const frame of frames) {
    if (excludeFileId && frame.id === excludeFileId) continue;
    const { x, y, width, height } = frame.geometry;
    if (
      point.x >= x &&
      point.x <= x + width &&
      point.y >= y &&
      point.y <= y + height
    ) {
      match = frame;
    }
  }
  return match;
}

export function computeFitCameraForFrames(
  frames: readonly FrameEntry[],
  viewport: { width: number; height: number },
  options?: { paddingScreenPx?: number },
) {
  if (frames.length === 0) return null;
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  const bounds = getFrameGroupBounds(frames);
  if (!bounds) return null;
  return getCameraForBounds(bounds, viewport, {
    paddingScreenPx: options?.paddingScreenPx ?? CANVAS_FIT_PADDING_PX,
    minZoom: DEFAULT_CANVAS_MIN_ZOOM,
    maxZoom: DEFAULT_CANVAS_MAX_ZOOM,
    fallbackZoom: 100,
  });
}

export function getOverviewZoomScale(args: {
  frameWidth: number | null | undefined;
  sourceWidth: number | null | undefined;
}) {
  const frameWidth =
    typeof args.frameWidth === "number" && args.frameWidth > 0
      ? args.frameWidth
      : OVERVIEW_FRAME_WIDTH;
  const sourceWidth =
    typeof args.sourceWidth === "number" && args.sourceWidth > 0
      ? args.sourceWidth
      : 1280;
  return frameWidth / sourceWidth;
}

export function getOverviewDisplayZoom(
  canvasZoom: number,
  overviewZoomScale: number,
) {
  const scale = overviewZoomScale > 0 ? overviewZoomScale : 1;
  return canvasZoom * scale;
}

export function getOverviewCanvasZoom(
  displayZoom: number,
  overviewZoomScale: number,
) {
  const scale = overviewZoomScale > 0 ? overviewZoomScale : 1;
  return displayZoom / scale;
}

export function getDefaultOverviewCanvasZoom(overviewZoomScale: number) {
  return getOverviewCanvasZoom(DEFAULT_OVERVIEW_ZOOM, overviewZoomScale);
}

export function resolveOverviewZoomBasisScreenId(args: {
  candidateFileId: string | null | undefined;
  boardFileId: string | null | undefined;
  overviewScreenIds: readonly string[];
}): string | null {
  const boardId = args.boardFileId ?? null;
  const candidate = args.candidateFileId ?? null;
  if (
    candidate &&
    candidate !== boardId &&
    args.overviewScreenIds.includes(candidate)
  ) {
    return candidate;
  }
  return (
    args.overviewScreenIds.find((screenId) => screenId !== boardId) ?? null
  );
}

export const MIN_RENDERABLE_OVERVIEW_DISPLAY_ZOOM = 0.01;

export function shouldResetExplicitOverviewZoomOnBasisChange(args: {
  previousBasisScreenId: string | null;
  nextBasisScreenId: string | null;
  explicitOverviewCanvasZoom: number | null;
  nextOverviewZoomScale: number;
}): boolean {
  if (args.explicitOverviewCanvasZoom === null) return false;
  if (args.previousBasisScreenId === args.nextBasisScreenId) return false;
  const nextDisplayZoom = getOverviewDisplayZoom(
    args.explicitOverviewCanvasZoom,
    args.nextOverviewZoomScale,
  );
  return (
    !Number.isFinite(nextDisplayZoom) ||
    nextDisplayZoom < MIN_RENDERABLE_OVERVIEW_DISPLAY_ZOOM ||
    nextDisplayZoom > DEFAULT_CANVAS_MAX_ZOOM
  );
}

export function shouldDeferOverviewZoomCommand(args: {
  hasZoomCommand: boolean;
  targetView: "single" | "overview" | undefined;
  filesLoaded: boolean;
}): boolean {
  return (
    args.hasZoomCommand && args.targetView === "overview" && !args.filesLoaded
  );
}

export function clampOverviewDisplayZoom(displayZoom: number): number {
  if (!Number.isFinite(displayZoom) || displayZoom <= 0) {
    return DEFAULT_OVERVIEW_ZOOM;
  }
  return Math.min(displayZoom, DEFAULT_CANVAS_MAX_ZOOM);
}

export function resolveZoomUpdate(
  update: SetStateAction<number>,
  current: number,
) {
  return typeof update === "function" ? update(current) : update;
}

export function getNextZoomStepUp(
  current: number,
  { min = DEFAULT_CANVAS_MIN_ZOOM, max = DEFAULT_CANVAS_MAX_ZOOM } = {},
): number {
  if (!Number.isFinite(current) || current <= 0) return Math.min(100, max);
  const exponent = Math.floor(Math.log2(current / 100) + 1e-9) + 1;
  const next = 100 * Math.pow(2, exponent);
  return clampZoom(next, min, max);
}

export function getNextZoomStepDown(
  current: number,
  { min = DEFAULT_CANVAS_MIN_ZOOM, max = DEFAULT_CANVAS_MAX_ZOOM } = {},
): number {
  if (!Number.isFinite(current) || current <= 0) return Math.max(100, min);
  const exponent = Math.ceil(Math.log2(current / 100) - 1e-9) - 1;
  const prev = 100 * Math.pow(2, exponent);
  return clampZoom(prev, min, max);
}

export function clampZoom(
  zoom: number,
  min: number = DEFAULT_CANVAS_MIN_ZOOM,
  max: number = DEFAULT_CANVAS_MAX_ZOOM,
): number {
  if (!Number.isFinite(zoom)) return min;
  return Math.min(max, Math.max(min, zoom));
}

export const MAX_SANE_SCREEN_ENTRY_ZOOM = 400;

export function resolveScreenEntryZoom(
  targetFileId: string | null | undefined,
  screenZoomById: ReadonlyMap<string, number>,
  defaultZoom: number,
): number {
  if (!targetFileId) return defaultZoom;
  const remembered = screenZoomById.get(targetFileId);
  if (remembered === undefined) return defaultZoom;
  if (!Number.isFinite(remembered) || remembered <= 0) return defaultZoom;
  const clamped = clampZoom(remembered);
  return clamped > MAX_SANE_SCREEN_ENTRY_ZOOM ? defaultZoom : clamped;
}

export function shouldPopToOverviewOnZoomOut(args: {
  previousZoom: number | null;
  zoom: number;
  threshold: number;
}): boolean {
  if (!Number.isFinite(args.zoom)) return false;
  if (args.zoom >= args.threshold) return false;
  return args.previousZoom !== null && args.previousZoom >= args.threshold;
}

export function shouldPopToOverviewOnZoomChange(args: {
  previousZoom: number | null;
  zoom: number;
  threshold: number;
  suppressExplicitZoom: boolean;
}): boolean {
  if (args.suppressExplicitZoom) return false;
  return shouldPopToOverviewOnZoomOut(args);
}

export function computeIframeLocalCanvasPoint(args: {
  clientX: number;
  clientY: number;
  iframeRect: { left: number; top: number } | null | undefined;
  zoomPercent: number;
}): { x: number; y: number } | null {
  if (!args.iframeRect || !(args.zoomPercent > 0)) return null;
  const factor = args.zoomPercent / 100;
  return {
    x: Math.max(0, (args.clientX - args.iframeRect.left) / factor),
    y: Math.max(0, (args.clientY - args.iframeRect.top) / factor),
  };
}

export function resolveScreenDropPoint(args: {
  clientX: number;
  clientY: number;
  screenId: string | null | undefined;
  iframeRect:
    | { left: number; top: number; right: number; bottom: number }
    | null
    | undefined;
  zoomPercent: number;
}): { screenId: string; x: number; y: number } | null {
  if (!args.screenId || !args.iframeRect) return null;
  if (
    args.clientX < args.iframeRect.left ||
    args.iframeRect.right < args.clientX ||
    args.clientY < args.iframeRect.top ||
    args.iframeRect.bottom < args.clientY
  ) {
    return null;
  }
  const point = computeIframeLocalCanvasPoint(args);
  return point ? { screenId: args.screenId, ...point } : null;
}

export function readOverviewZoomPercentFromTransform(
  transform: string | null | undefined,
  fallbackZoomPercent: number,
): number {
  const match = transform?.match(/(?:^|\s)scale\(\s*([-+]?\d*\.?\d+)\s*\)/i);
  const scale = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(scale) && scale > 0
    ? scale * 100
    : fallbackZoomPercent;
}

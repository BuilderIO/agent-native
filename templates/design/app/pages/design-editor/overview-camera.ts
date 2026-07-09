import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import {
  DEFAULT_CANVAS_MAX_ZOOM,
  DEFAULT_CANVAS_MIN_ZOOM,
  getCameraForBounds,
  getFrameGroupBounds,
  type FrameEntry,
} from "@shared/canvas-math";
import type { SetStateAction } from "react";

import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import { OVERVIEW_FRAME_WIDTH } from "@/components/design/multi-screen/overview-layout";
import type {
  FrameGeometry,
  Point,
} from "@/components/design/multi-screen/types";

export const DEFAULT_OVERVIEW_ZOOM = 60;

/**
 * Vector-edit foundations (P5 integration): resolves the canvas-space point
 * where a screen's own screen-content-local (0,0) sits — i.e.
 * `VectorEditOverlayState.originCanvas` — for a committed pen path owned by
 * `screenId`.
 *
 * Mirrors the exact same fallback-merge (`getInitialFrameGeometry(index,
 * ...)` overridden by any persisted `canvasFrameGeometryById` entry) that
 * `getSelectedScreenGeometryForInspector` above and MultiScreenCanvas's own
 * internal frame-geometry resolution both use, so the overlay lines up with
 * whatever frame position is actually rendered on screen.
 *
 * The reserved board file (`__board__.html`, see shared/board-file.ts) is the
 * one exception: `handleBoardDrawPrimitive`/`persistDraftPrimitive` commit
 * board primitives with a 1:1 `{x:0,y:0,width:1,height:1}` frame (no offset
 * subtraction — see MultiScreenCanvas's persistDraftPrimitive), so a board
 * pen path's nodes are already in absolute canvas coordinates and
 * `originCanvas` is `{0, 0}`.
 *
 * Returns `null` when the screen can't be resolved (not in `overviewScreens`
 * and not the board file) — the caller should not enter vector-edit mode in
 * that case.
 */
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

/**
 * Resolves every overview screen's effective canvas-space frame geometry —
 * persisted `canvasFrameGeometryById` entry merged over the same
 * `getInitialFrameGeometry(index, ...)` fallback `getSelectedScreenGeometryForInspector`
 * and `getScreenFrameOriginCanvas` above already use — as `FrameEntry[]` for
 * `@shared/canvas-math` bounds/fit helpers (`getFrameGroupBounds`,
 * `getCameraForBounds`). Optionally includes the board frame (real Figma has
 * no board-file equivalent, but a design with only board primitives and no
 * screens should still have something to fit to).
 */
export function getAllScreenFrameEntries(args: {
  overviewScreens: Array<{
    id: string;
    width?: number;
    height?: number;
  }>;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  boardFrameGeometry?: FrameGeometry;
  boardFileId?: string | null;
}): FrameEntry[] {
  const entries: FrameEntry[] = args.overviewScreens.map((screen, index) => {
    const fallbackGeometry = getInitialFrameGeometry(index, {
      width: screen.width ?? 1280,
      height: screen.height ?? 2560,
    });
    const persistedGeometry = args.canvasFrameGeometryById[screen.id] ?? {};
    return {
      id: screen.id,
      geometry: { ...fallbackGeometry, ...persistedGeometry },
    };
  });
  if (
    args.boardFileId &&
    args.boardFrameGeometry &&
    !entries.some((entry) => entry.id === args.boardFileId)
  ) {
    entries.push({ id: args.boardFileId, geometry: args.boardFrameGeometry });
  }
  return entries;
}

/**
 * Hit-tests a canvas-space point (the same coordinate system
 * `getAllScreenFrameEntries` resolves frame geometry into) against every real
 * screen frame — excluding `excludeFileId` (the board file itself, which is
 * only a paste-target FALLBACK, never a hit-testable "screen" to drop into).
 * Used by overview image/content paste (see handlePastedImageFiles) to decide
 * whether a paste anchor point lands on a screen — and if so, which one — so
 * the paste can be inserted into that screen's own local coordinate space
 * instead of always landing on the shared board file.
 *
 * When multiple frames overlap at the point (frames can be freely dragged on
 * top of each other), the LAST matching entry wins — `overviewScreens`/
 * `getAllScreenFrameEntries` order screens back-to-front by z, matching
 * MultiScreenCanvas's own render order, so this picks the topmost screen at
 * that point, same as a real click would hit.
 */
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

/**
 * Figma's Shift+1 ("Zoom to fit") / Shift+2 ("Zoom to selection"): compute the
 * real fit zoom + canvas offset for a set of frames within the given viewport
 * size, via the shared `getCameraForBounds` fit-viewport math (already used
 * nowhere else in this app — this is the first caller — so this is a thin
 * wrapper that resolves the frame-entries-to-bounds step and clamps to the
 * shared canvas zoom range). Returns null when there is nothing to fit
 * (no frames, or a degenerate/zero-size viewport).
 */
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
    paddingScreenPx: options?.paddingScreenPx ?? 64,
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

/**
 * Board-zoom-corruption fix (observed in the wild as a 10241.49% displayed
 * zoom): the overview zoom SCALE basis must always be a real overview screen.
 * When `activeFileId` flips to the board file (creating a text primitive on
 * the empty board, clicking a board element, …) or to any non-screen file
 * (e.g. a CSS support file), the old `activeFile?.id ?? activeFileId ??
 * overviewScreens[0]?.id` resolution made that file the basis: it has no
 * entry in `overviewScreens` OR `canvasFrames`, so BOTH getOverviewZoomScale
 * inputs fell back (320/1280 = 0.25) while `explicitOverviewCanvasZoom`
 * stayed pinned to a value established under the real screen's scale —
 * garbage displayed zoom. This helper only accepts a candidate that is a
 * known overview screen (and never the board, even if a future
 * `overviewScreens` regression let the board leak into the list), otherwise
 * it falls back to the first real overview screen.
 */
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

/**
 * Displayed overview zooms below this are unrenderable garbage, not a
 * deliberate camera position — the wheel/pinch path can't legitimately reach
 * them (MultiScreenCanvas clamps its canvas zoom well above the product of
 * this with any real screen scale).
 */
export const MIN_RENDERABLE_OVERVIEW_DISPLAY_ZOOM = 0.01;

/**
 * Board-zoom-corruption fix, defensive layer: when the zoom-scale BASIS
 * IDENTITY changes (a different screen becomes the basis), a pinned
 * `explicitOverviewCanvasZoom` was established under the OLD basis' scale.
 * A normal screen-to-screen basis change only shifts the displayed zoom
 * label by the two screens' native-scale ratio (camera untouched) — that is
 * intended Figma-like behavior and must NOT reset the camera. But if the new
 * basis' scale turns the pinned value into a displayed zoom outside the
 * editor's absolute zoom range (non-finite, unrenderably small, or above
 * DEFAULT_CANVAS_MAX_ZOOM), the pin is provably garbage for this basis:
 * invalidate it so the derivation re-anchors at the default overview zoom
 * instead of showing a corrupted percentage.
 */
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

/**
 * Final sanity clamp on the DISPLAYED overview zoom (the number the zoom
 * field shows and zoom-relative flows consume). Non-finite/non-positive
 * products (a corrupted basis flip) fall back to the default overview zoom;
 * anything above the editor's absolute max zoom is capped there. The lower
 * bound is deliberately NOT floored to DEFAULT_CANVAS_MIN_ZOOM: a legit
 * canvas zoom near the minimum times a sub-1 screen scale can display below
 * 2% and must not be misreported (it would desync the displayed value from
 * the real camera and drift zoom-relative round-trips).
 */
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

/**
 * Figma-style zoom stepping: doubling/halving anchors relative to 100%
 * (…6.25, 12.5, 25, 50, 100, 200, 400, 800…) instead of a small fixed preset
 * list that stalls once it runs out of entries. Used by the keyboard/menu
 * zoom in/out handlers so they never stop stepping above/below the old
 * ZOOM_PRESETS bounds — clamped to the shared canvas zoom range so the
 * result always matches what the wheel/pinch zoom path allows.
 */
export function getNextZoomStepUp(
  current: number,
  { min = DEFAULT_CANVAS_MIN_ZOOM, max = DEFAULT_CANVAS_MAX_ZOOM } = {},
): number {
  if (!Number.isFinite(current) || current <= 0) return Math.min(100, max);
  // Anchor exponent: how many doublings 100 * 2^n is from `current`. Round up
  // (with a small epsilon so an exact anchor doesn't get skipped by float
  // error) to find the next anchor strictly greater than current.
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

/**
 * Camera-restore sanity ceiling (item 5): the shared canvas zoom range
 * (DEFAULT_CANVAS_MIN_ZOOM..DEFAULT_CANVAS_MAX_ZOOM, up to 25600%) is sized
 * for a deliberate "zoom in on this one selection" gesture, not for restoring
 * a "where I left off" per-screen memory. A corrupted/degenerate remembered
 * zoom (e.g. 1506%/3968%, observed in the field) is technically within that
 * absolute range but re-entering a screen at it shows an unrecognizable
 * close-up of whatever happens to sit at the scroll container's default
 * (0,0) origin — effectively "lands on empty canvas" from the user's
 * perspective, since single-screen mode has no separate persisted pan
 * position to also restore in sync. Restoring a saner default here is this
 * app's equivalent of a fit-all fallback.
 */
export const MAX_SANE_SCREEN_ENTRY_ZOOM = 400;

/**
 * Per-screen zoom memory: resolve which zoom `enterSingleScreen` should
 * restore for a given target screen id. Looks up the screen's last-
 * remembered zoom in the `screenZoomById` map (populated as the user zooms
 * while a screen is focused); falls back to `defaultZoom` (FOCUSED_SCREEN_ZOOM
 * in practice) for a screen's first visit, when no target id is known, or
 * when the remembered value is missing/non-finite/outside the shared canvas
 * zoom range, or so extreme (see MAX_SANE_SCREEN_ENTRY_ZOOM) that restoring it
 * would show unrecognizable content instead of the screen the user expects.
 * Pure/extracted so this lookup rule is unit-testable without mounting the
 * full DesignEditor component.
 */
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

/**
 * BP-DEEP v2 item 2 (full-view mode flicker) — the Figma-style "zoom far
 * enough out of a focused screen and you pop back to the overview" heuristic
 * must only fire when the user actually ZOOMS OUT ACROSS the threshold while
 * already settled in single-screen view. The previous level-triggered check
 * (`zoom < threshold` → pop) also fired on ENTRY: enterSingleScreen restores
 * the screen's remembered zoom, and when that remembered value was below the
 * threshold the editor flashed into full view for one frame and immediately
 * bounced back to overview — Steve's "Full view flickers then bounces" bug.
 * Edge-triggering on the previous observed single-view zoom means entry
 * (previousZoom === null — the tracking ref resets whenever single view is
 * left) can never bounce, and an entry that legitimately restores e.g. 30%
 * stays a focused 30% view until the user crosses the threshold from above.
 * Pure/extracted for unit tests.
 */
export function shouldPopToOverviewOnZoomOut(args: {
  /** Last zoom observed while ALREADY in single view; null right after
   *  entering single view (or when single view isn't active/edit-mode). */
  previousZoom: number | null;
  zoom: number;
  threshold: number;
}): boolean {
  if (!Number.isFinite(args.zoom)) return false;
  if (args.zoom >= args.threshold) return false;
  return args.previousZoom !== null && args.previousZoom >= args.threshold;
}

/**
 * Fix-wave (zoom presets) — an explicit destination zoom (a "Zoom to
 * 50/100/200%" menu preset, or a typed zoom-% commit) crosses
 * OVERVIEW_ZOOM_THRESHOLD from above just as easily as a real zoom-out
 * gesture does (e.g. the default single-view zoom is 100%, and "Zoom to 50%"
 * lands under the 60% threshold) — `shouldPopToOverviewOnZoomOut` alone can't
 * tell the two apart from the raw before/after zoom numbers. Callers that
 * fire an explicit destination zoom mark the NEXT zoom-change observation as
 * suppressed; this combines that one-shot flag with the edge-trigger check so
 * "Zoom to 50%" always stays in single view regardless of the zoom it
 * started from, while continuous zoom-out (scroll/pinch/the zoom-out button)
 * is untouched and still pops at the threshold like Figma.
 */
export function shouldPopToOverviewOnZoomChange(args: {
  previousZoom: number | null;
  zoom: number;
  threshold: number;
  suppressExplicitZoom: boolean;
}): boolean {
  if (args.suppressExplicitZoom) return false;
  return shouldPopToOverviewOnZoomOut(args);
}

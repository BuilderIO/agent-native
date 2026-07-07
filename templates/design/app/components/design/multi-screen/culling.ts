import { getRotatedFrameAABB } from "@shared/canvas-math";

import { SURFACE_PADDING } from "../MultiScreenCanvas";
import type { FrameGeometry, Point } from "./types";

// ── Overview viewport culling (PF22) ────────────────────────────────────────
//
// Boards with 100+ screens used to render every screen as a full live iframe
// regardless of whether it was anywhere near the visible viewport. This is a
// deliberately conservative culling scheme:
//
// - Visibility is computed from the *committed* pan/zoom React state (`pan`,
//   `canvasZoom`), never from the imperative per-gesture-frame transform
//   (zoomRef/panRef, mutated by applyViewToDom every wheel/pinch tick — see
//   its comment). Recomputing this per gesture frame would mean re-rendering
//   React during a gesture, exactly what applyViewToDom/scheduleViewCommit
//   were built to avoid.
// - A generous overscan margin keeps screens "live" well before they
//   physically enter the viewport, so a settled-but-about-to-pan-into-view
//   screen (the debounced commit lags real cursor position by up to
//   ~120ms — see scheduleViewCommit) is already mounted by the time it's
//   reachable.
// - Two tiers, see computeScreenCullTier: a screen that has never intersected
//   the overscanned viewport this session renders a lightweight placeholder;
//   once visible it mounts real content and never goes back to a placeholder
//   — it only ever gets hidden (Tier B), never unmounted, since iframes lose
//   all internal state (scroll position, form input, Alpine/JS state) on
//   unmount.

/** Escape hatch: flip to `false` to fully disable culling in one line if a
 *  regression appears — every screen goes back to always rendering full
 *  content, matching pre-culling behavior exactly. */
export const OVERVIEW_CULLING_ENABLED = true;

/** How many viewport widths/heights of margin to add around the visible
 *  surface, in each direction, before a screen counts as "culled". Generous
 *  on purpose: the mission calls for >=1.5x, so screens scrolling into view
 *  during an in-flight gesture are already live before the debounced
 *  ~120ms view-commit (see scheduleViewCommit) catches up and this
 *  recomputes. */
export const OVERVIEW_CULLING_OVERSCAN_FACTOR = 1.5;

export type ScreenCullTier =
  /** Full content (iframe/DesignCanvas) is mounted and rendered normally. */
  | "visible"
  /** Has been visible before this session; content stays mounted (iframes
   *  never unmount — see the module doc above) but is skipped from paint via
   *  visibility/content-visibility, not display:none or will-change. */
  | "culled"
  /** Has never been visible this session; renders a lightweight placeholder
   *  with no iframe/content node at all. */
  | "placeholder";

/** The world-space (canvas-space) rectangle currently visible inside the
 *  pannable surface, expanded by `overscanFactor` viewport-widths/heights in
 *  every direction. Built from the *committed* pan/zoom state, matching the
 *  same `translate(pan) scale(zoom/100)` transform applyViewToDom applies to
 *  the world layer — see getOverscannedViewportCanvasBounds's callers. */
export interface OverscannedViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Computes the overscanned world-space viewport rect for culling purposes.
 *  `surfaceSize` is the pannable surface's own on-screen size (the
 *  `surfaceRef` element's content box, in screen px); `pan`/`zoomPercent` are
 *  the committed (not per-gesture-frame) pan/zoom values. Screens are placed
 *  in world space with `SURFACE_PADDING` added to their raw x/y (see Screen's
 *  wrapper style), so this returns bounds already in that same
 *  `SURFACE_PADDING`-relative space — compare directly against
 *  `geometry.x`/`geometry.y`-based frame bounds, no further offset needed.
 *  Returns `null` when the surface has no measured size yet (e.g. before the
 *  first layout pass) — callers should treat that as "cannot determine
 *  visibility yet" and fall back to treating everything as visible. */
export function getOverscannedViewportCanvasBounds(
  surfaceSize: { width: number; height: number },
  pan: Point,
  zoomPercent: number,
  overscanFactor: number = OVERVIEW_CULLING_OVERSCAN_FACTOR,
): OverscannedViewportBounds | null {
  if (surfaceSize.width <= 0 || surfaceSize.height <= 0) return null;
  const scale = zoomPercent / 100;
  if (!(scale > 0)) return null;
  // Visible world-space rect: screen-space [0, surfaceSize] maps back through
  // the world transform (`screenPoint = pan + worldPoint * scale`) to
  // `worldPoint = (screenPoint - pan) / scale`. This mirrors
  // screenToCanvasPoint's own inverse-transform math but is kept local here
  // (rather than imported) since it operates on the *committed* pan/zoom
  // React state specifically, not the live gesture pan/zoom.
  const visibleLeft = -pan.x / scale;
  const visibleTop = -pan.y / scale;
  const visibleWidth = surfaceSize.width / scale;
  const visibleHeight = surfaceSize.height / scale;
  const overscanX = visibleWidth * overscanFactor;
  const overscanY = visibleHeight * overscanFactor;
  return {
    left: visibleLeft - overscanX - SURFACE_PADDING,
    top: visibleTop - overscanY - SURFACE_PADDING,
    right: visibleLeft + visibleWidth + overscanX - SURFACE_PADDING,
    bottom: visibleTop + visibleHeight + overscanY - SURFACE_PADDING,
  };
}

/** True when `geometry`'s (rotation-aware) bounds intersect the overscanned
 *  viewport rect at all — i.e. the screen is not fully outside it. Uses
 *  `getRotatedFrameAABB` so a rotated frame's actual on-screen footprint is
 *  tested, not its unrotated local rect. */
export function isFrameWithinOverscannedViewport(
  geometry: FrameGeometry,
  viewport: OverscannedViewportBounds,
): boolean {
  const bounds = getRotatedFrameAABB(geometry);
  return (
    bounds.right >= viewport.left &&
    bounds.left <= viewport.right &&
    bounds.bottom >= viewport.top &&
    bounds.top <= viewport.bottom
  );
}

/**
 * Item 4 — frame-tool/preset new-screen placement guard. A degenerate camera
 * (corrupted/extreme pan+zoom — see item 5's camera-restore fix) makes
 * getCanvasPoint's screen-to-world conversion blow up (dividing by a near-
 * zero zoom scale), so a click-to-place or drag-to-draw frame gesture can
 * compute world coordinates in the tens of thousands (observed: ±65536-ish)
 * instead of landing near what the user actually clicked. Clamps the
 * proposed geometry's origin to sit within `viewport` (the current
 * OverscannedViewportBounds with overscanFactor 0, i.e. the exact visible
 * world-rect) — centering it there when the proposed origin falls outside —
 * so a bad camera can never fling a new screen to infinity. Only the origin
 * is clamped (not width/height): the frame tool's own min/default size rules
 * already bound those, and centering a same-sized frame preserves the
 * gesture's intended dimensions.
 */
export function clampFrameGeometryToViewport(
  geometry: FrameGeometry,
  viewport: OverscannedViewportBounds | null,
): FrameGeometry {
  if (!viewport) return geometry;
  const viewportWidth = viewport.right - viewport.left;
  const viewportHeight = viewport.bottom - viewport.top;
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return geometry;
  const isWithin = isFrameWithinOverscannedViewport(geometry, viewport);
  if (isWithin) return geometry;
  return {
    ...geometry,
    x: viewport.left + (viewportWidth - geometry.width) / 2,
    y: viewport.top + (viewportHeight - geometry.height) / 2,
  };
}

/** Resolves the culling tier for a single screen. `alwaysVisible` covers the
 *  mission's "always treated as visible" overrides: the active/board screen
 *  and anything in the current selection, regardless of position — Figma
 *  itself never culls the object you're actively editing or have selected,
 *  and keeping these paths iframe-backed avoids any risk of interrupting
 *  in-progress edits/bridge state on the screen the user is looking at.
 *  `viewport` is `null` when surface size isn't known yet (initial layout) —
 *  treated as visible so nothing is incorrectly culled before we can measure.
 *  `hasBeenVisible` should reflect whether this screen id has *ever* been
 *  visible this session (see the hasBeenVisibleRef Set in MultiScreenCanvas):
 *  once true, a screen can only be "visible" or "culled", never regress to
 *  "placeholder". */
export function computeScreenCullTier({
  geometry,
  viewport,
  alwaysVisible,
  hasBeenVisible,
}: {
  geometry: FrameGeometry;
  viewport: OverscannedViewportBounds | null;
  alwaysVisible: boolean;
  hasBeenVisible: boolean;
}): ScreenCullTier {
  if (!OVERVIEW_CULLING_ENABLED) return "visible";
  const isWithinViewport =
    alwaysVisible ||
    !viewport ||
    isFrameWithinOverscannedViewport(geometry, viewport);
  if (isWithinViewport) return "visible";
  return hasBeenVisible ? "culled" : "placeholder";
}

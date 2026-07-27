import { getRotatedFrameAABB } from "@shared/canvas-math";

import { SURFACE_PADDING } from "./overview-layout";
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
// - A bounded live-context pool keeps nearby screens warm without retaining
//   every browsing context ever visited. Active/selected/in-progress screens
//   are protected; the remaining budget is filled by viewport distance and
//   then by recency. Evicted screens keep their lightweight React content-cache
//   entry so revisiting can remount directly without rebuilding source HTML.

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

/** Maximum number of evictable overview browsing contexts kept mounted at
 * once. One screen costs its primary preview plus every breakpoint preview.
 * Interaction-protected screens are the sole safety exception: if the user
 * explicitly selects more than this budget, preserving their live editor
 * state wins until that interaction ends, after which the pool contracts on
 * the next culling pass. */
export const OVERVIEW_LIVE_IFRAME_BUDGET = 32;

export type ScreenCullTier =
  /** Full content (iframe/DesignCanvas) is mounted and rendered normally. */
  | "visible"
  /** Has been visible before this session; content stays mounted (iframes
   *  remains inside the bounded warm pool) but is skipped from paint via
   *  visibility/content-visibility, not display:none or will-change. */
  | "culled"
  /** Has rendered before but was least-recently-used outside the bounded live
   *  iframe pool. Its browsing contexts are unmounted; the cached React node
   *  is retained so a revisit can remount without regenerating content. */
  | "evicted"
  /** Has never been visible this session; renders a lightweight placeholder
   *  with no iframe/content node at all. */
  | "placeholder";

/** Shared render lifecycle for every iframe belonging to one screen, including
 * breakpoint previews. Warm offscreen screens remain mounted and hidden;
 * never-seen and LRU-evicted screens own no browsing contexts. */
export function getScreenContentCullState(tier: ScreenCullTier): {
  shouldMount: boolean;
  isHidden: boolean;
} {
  return {
    shouldMount: tier === "visible" || tier === "culled",
    isHidden: tier === "culled",
  };
}

export interface ScreenCullCandidate {
  id: string;
  geometry: FrameGeometry;
  /** Primary preview plus all breakpoint preview iframes for this screen. */
  iframeCount: number;
}

export interface BoundedScreenCullState {
  tierByScreenId: Map<string, ScreenCullTier>;
  liveScreenIds: Set<string>;
  everVisibleScreenIds: Set<string>;
  lastVisibleEpochByScreenId: Map<string, number>;
  mountedIframeCount: number;
}

function normalizedIframeCount(candidate: ScreenCullCandidate): number {
  return Math.max(1, Math.floor(candidate.iframeCount));
}

function distanceSquaredToViewportCenter(
  geometry: FrameGeometry,
  viewport: OverscannedViewportBounds,
): number {
  const bounds = getRotatedFrameAABB(geometry);
  const dx =
    (bounds.left + bounds.right) / 2 - (viewport.left + viewport.right) / 2;
  const dy =
    (bounds.top + bounds.bottom) / 2 - (viewport.top + viewport.bottom) / 2;
  return dx * dx + dy * dy;
}

/**
 * Allocate overview browsing contexts under a bounded LRU/distance budget.
 *
 * Allocation order is intentional:
 * 1. protected interactions (active, selected, dragged, text/layer edited),
 * 2. screens inside the overscanned viewport, nearest the viewport center,
 * 3. previously-mounted offscreen screens, most recently visible first.
 *
 * This keeps imminent pan/zoom destinations live while guaranteeing that a
 * long tour through a 100+ screen board cannot accumulate 100+ hidden iframe
 * documents. The function is pure: callers own the returned Set/Map snapshots
 * and can feed them into the next committed pan/zoom pass.
 */
export function computeBoundedScreenCullState({
  candidates,
  viewport,
  protectedScreenIds,
  previousLiveScreenIds,
  everVisibleScreenIds,
  lastVisibleEpochByScreenId,
  accessEpoch,
  liveIframeBudget = OVERVIEW_LIVE_IFRAME_BUDGET,
}: {
  candidates: readonly ScreenCullCandidate[];
  viewport: OverscannedViewportBounds | null;
  protectedScreenIds: ReadonlySet<string>;
  previousLiveScreenIds: ReadonlySet<string>;
  everVisibleScreenIds: ReadonlySet<string>;
  lastVisibleEpochByScreenId: ReadonlyMap<string, number>;
  accessEpoch: number;
  liveIframeBudget?: number;
}): BoundedScreenCullState {
  if (!OVERVIEW_CULLING_ENABLED) {
    const allIds = new Set(candidates.map((candidate) => candidate.id));
    return {
      tierByScreenId: new Map(
        candidates.map((candidate) => [candidate.id, "visible"] as const),
      ),
      liveScreenIds: allIds,
      everVisibleScreenIds: allIds,
      lastVisibleEpochByScreenId: new Map(
        candidates.map((candidate) => [candidate.id, accessEpoch] as const),
      ),
      mountedIframeCount: candidates.reduce(
        (total, candidate) => total + normalizedIframeCount(candidate),
        0,
      ),
    };
  }

  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate] as const),
  );
  const viewportScreenIds = new Set<string>();
  if (viewport) {
    for (const candidate of candidates) {
      if (isFrameWithinOverscannedViewport(candidate.geometry, viewport)) {
        viewportScreenIds.add(candidate.id);
      }
    }
  }

  const nextLastVisible = new Map(lastVisibleEpochByScreenId);
  for (const id of protectedScreenIds) {
    if (candidateById.has(id)) nextLastVisible.set(id, accessEpoch);
  }
  for (const id of viewportScreenIds) nextLastVisible.set(id, accessEpoch);

  const nextLive = new Set<string>();
  let mountedIframeCount = 0;
  const add = (candidate: ScreenCullCandidate) => {
    if (nextLive.has(candidate.id)) return;
    nextLive.add(candidate.id);
    mountedIframeCount += normalizedIframeCount(candidate);
  };

  // Protected editor interactions must never be destroyed mid-gesture/edit.
  for (const candidate of candidates) {
    if (protectedScreenIds.has(candidate.id)) add(candidate);
  }
  // Protected screens can temporarily exceed the normal pool. In that case
  // no evictable iframe is admitted until the interaction set shrinks again.
  const effectiveBudget = Math.max(
    Math.max(0, Math.floor(liveIframeBudget)),
    mountedIframeCount,
  );
  const tryAddWithinBudget = (candidate: ScreenCullCandidate) => {
    if (nextLive.has(candidate.id)) return;
    if (
      mountedIframeCount + normalizedIframeCount(candidate) <=
      effectiveBudget
    ) {
      add(candidate);
    }
  };

  const visibleCandidates = candidates
    .filter(
      (candidate) =>
        viewportScreenIds.has(candidate.id) &&
        !protectedScreenIds.has(candidate.id),
    )
    .sort((a, b) => {
      if (!viewport) return a.id.localeCompare(b.id);
      const distanceDelta =
        distanceSquaredToViewportCenter(a.geometry, viewport) -
        distanceSquaredToViewportCenter(b.geometry, viewport);
      if (distanceDelta !== 0) return distanceDelta;
      const recencyDelta =
        (nextLastVisible.get(b.id) ?? -1) - (nextLastVisible.get(a.id) ?? -1);
      return recencyDelta || a.id.localeCompare(b.id);
    });
  visibleCandidates.forEach(tryAddWithinBudget);

  const warmCandidates = candidates
    .filter(
      (candidate) =>
        previousLiveScreenIds.has(candidate.id) &&
        !viewportScreenIds.has(candidate.id) &&
        !protectedScreenIds.has(candidate.id),
    )
    .sort((a, b) => {
      const recencyDelta =
        (nextLastVisible.get(b.id) ?? -1) - (nextLastVisible.get(a.id) ?? -1);
      return recencyDelta || a.id.localeCompare(b.id);
    });
  warmCandidates.forEach(tryAddWithinBudget);

  const nextEverVisible = new Set(everVisibleScreenIds);
  const tierByScreenId = new Map<string, ScreenCullTier>();
  for (const candidate of candidates) {
    const isProtected = protectedScreenIds.has(candidate.id);
    const isInViewport = viewportScreenIds.has(candidate.id);
    const isLive = nextLive.has(candidate.id);
    if (isLive && (isProtected || isInViewport)) {
      nextEverVisible.add(candidate.id);
      tierByScreenId.set(candidate.id, "visible");
    } else if (isLive) {
      tierByScreenId.set(candidate.id, "culled");
    } else if (nextEverVisible.has(candidate.id)) {
      tierByScreenId.set(candidate.id, "evicted");
    } else {
      tierByScreenId.set(candidate.id, "placeholder");
    }
  }

  const liveIds = new Set(candidateById.keys());
  for (const id of nextEverVisible) {
    if (!liveIds.has(id)) nextEverVisible.delete(id);
  }
  for (const id of nextLastVisible.keys()) {
    if (!liveIds.has(id)) nextLastVisible.delete(id);
  }

  return {
    tierByScreenId,
    liveScreenIds: nextLive,
    everVisibleScreenIds: nextEverVisible,
    lastVisibleEpochByScreenId: nextLastVisible,
    mountedIframeCount,
  };
}

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
 *  first layout pass). Callers keep only active/selected or previously-live
 *  screens mounted until measurement; otherwise a cold open would eagerly
 *  instantiate every iframe and permanently defeat placeholder culling. */
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
 *  `viewport` is `null` when surface size isn't known yet (initial layout).
 *  Active/selected screens stay visible, previously-live screens stay mounted
 *  but culled, and never-seen screens remain placeholders until measurement.
 *  `hasBeenVisible` should reflect whether this screen id has *ever* been
 *  visible this session (see the hasBeenVisibleRef Set in MultiScreenCanvas).
 *  This low-level geometry helper does not apply the live-iframe budget;
 *  computeBoundedScreenCullState layers the separate "evicted" tier on top. */
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
  if (alwaysVisible) return "visible";
  if (!viewport) return hasBeenVisible ? "culled" : "placeholder";
  const isWithinViewport = isFrameWithinOverscannedViewport(geometry, viewport);
  if (isWithinViewport) return "visible";
  return hasBeenVisible ? "culled" : "placeholder";
}

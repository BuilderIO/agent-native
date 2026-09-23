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
//   are protected; the remaining budget first preserves already-live screens
//   that are still in the raw viewport, then fills by viewport distance and
//   recency. Evicted screens keep their lightweight React content-cache entry
//   so revisiting can remount directly without rebuilding source HTML.

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
export const OVERVIEW_CULLING_OVERSCAN_FACTOR = 2;

/** Maximum number of evictable overview SCREENS kept mounted at once.
 *
 * The pool is budgeted in screens rather than iframes because a screen is the
 * unit the user perceives: a board where every screen carries breakpoint
 * previews costs several browsing contexts per screen, and charging those
 * against one flat iframe budget shrank the pool to a third of its intended
 * size. Past that point every committed pan/zoom re-ranked the in-viewport set
 * by distance and admitted a different subset, so screens were destroyed and
 * re-created — a document reload, i.e. a visible flash — on ordinary camera
 * movement. Generating a variant set installs a design-wide breakpoint set, so
 * this regressed the moment variants existed.
 *
 * Interaction-protected screens are the sole safety exception: if the user
 * explicitly selects more than this budget, preserving their live editor
 * state wins until that interaction ends, after which the pool contracts on
 * the next culling pass. */
export const OVERVIEW_LIVE_SCREEN_BUDGET = 32;

/** Hard ceiling on total mounted browsing contexts, independent of the screen
 * budget above. This is the memory backstop the original budget existed for —
 * a long tour of a 100+ screen board still cannot accumulate contexts without
 * bound — set high enough that a normal breakpoint-bearing board is limited by
 * OVERVIEW_LIVE_SCREEN_BUDGET instead of by this. */
export const OVERVIEW_LIVE_IFRAME_CEILING = 96;

/** Maximum number of live app documents allowed to boot simultaneously. */
export const OVERVIEW_LIVE_BOOT_BUDGET = 4;

/** On-screen width (CSS px) below which an unprotected inline screen renders a
 * static preview instead of a live editor document. Nothing inside a frame
 * that small can be targeted, and every editor document carries the full
 * editor bridge, parsed and compiled on the editor's own main thread. */
export const OVERVIEW_LIVE_EDITOR_MIN_SCREEN_PX = 240;

/** A live editor survives zooming out to this fraction of the promotion
 * width, so a zoom that settles near the threshold cannot reload it on every
 * commit. */
const LIVE_EDITOR_DEMOTE_RATIO = 0.75;

/** Static previews mounted for screens outside the live pool. They carry no
 * editor bridge, but each is still a browsing context. */
export const OVERVIEW_STATIC_PREVIEW_BUDGET = 64;

/** Viewport margin for static previews, in viewport widths/heights. */
export const OVERVIEW_STATIC_PREVIEW_OVERSCAN_FACTOR = 0.5;

/** Screens that get a full editor document rather than a static preview.
 * `alwaysLive` covers screens a static preview cannot stand in for (URL-backed
 * apps) and interactions that need the bridge (active, selected, hovered,
 * dragged, export preview). */
export function resolveLiveEditorScreenIds({
  candidates,
  zoomPercent,
  previousIds,
  minScreenPx = OVERVIEW_LIVE_EDITOR_MIN_SCREEN_PX,
}: {
  candidates: readonly { id: string; width: number; alwaysLive: boolean }[];
  zoomPercent: number;
  previousIds: ReadonlySet<string>;
  minScreenPx?: number;
}): Set<string> {
  const scale = zoomPercent / 100;
  const live = new Set<string>();
  for (const { id, width, alwaysLive } of candidates) {
    const screenPx = width * scale;
    if (
      alwaysLive ||
      screenPx >= minScreenPx ||
      (previousIds.has(id) &&
        screenPx >= minScreenPx * LIVE_EDITOR_DEMOTE_RATIO)
    ) {
      live.add(id);
    }
  }
  return live;
}

/** Nearest-first static previews for screens with no mounted content, so a
 * zoomed-out board shows its screens instead of name-only boxes without
 * mounting a document for every screen of a very large board. */
export function selectStaticPreviewScreenIds({
  candidates,
  viewport,
  budget = OVERVIEW_STATIC_PREVIEW_BUDGET,
}: {
  candidates: readonly { id: string; geometry: FrameGeometry }[];
  viewport: OverscannedViewportBounds | null;
  budget?: number;
}): Set<string> {
  if (!viewport) return new Set();
  return new Set(
    orderByViewportDistance(
      candidates.filter(({ geometry }) =>
        isFrameWithinOverscannedViewport(geometry, viewport),
      ),
      viewport,
    ).slice(0, Math.max(0, Math.floor(budget))),
  );
}

/** Ids nearest the viewport center first; input order without a viewport. */
export function orderByViewportDistance(
  candidates: readonly { id: string; geometry: FrameGeometry }[],
  viewport: OverscannedViewportBounds | null,
): string[] {
  if (!viewport) return candidates.map(({ id }) => id);
  return candidates
    .map(({ id, geometry }) => ({
      id,
      distance: distanceSquaredToViewportCenter(geometry, viewport),
    }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .map(({ id }) => id);
}

/** New overview iframe documents admitted per animation frame. Same-process
 * iframes are built, styled and laid out on the editor's own main thread, so
 * mounting a zoomed-out board's worth of previews in one commit put dozens of
 * new documents into a single frame. */
export const OVERVIEW_IFRAME_ADMISSIONS_PER_FRAME = 8;

/** Up to this many wanted iframes mount together, so a small board renders
 * all of its screens in its first frame instead of trickling them in. */
export const OVERVIEW_IFRAME_INSTANT_ADMISSION_MAX = 8;

/** Paces iframe mounting. `wantedIds` is priority order (nearest first); ids
 * that left it are dropped at once, `immediateIds` never wait, and at most
 * `perFrame` other new ids are admitted per call. The caller repeats once per
 * animation frame until every wanted id is admitted. */
export function admitIframesProgressively({
  wantedIds,
  admittedIds,
  immediateIds,
  perFrame = OVERVIEW_IFRAME_ADMISSIONS_PER_FRAME,
  instantMax = OVERVIEW_IFRAME_INSTANT_ADMISSION_MAX,
}: {
  wantedIds: readonly string[];
  admittedIds: ReadonlySet<string>;
  immediateIds: ReadonlySet<string>;
  perFrame?: number;
  instantMax?: number;
}): Set<string> {
  let budget =
    wantedIds.length <= instantMax
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(perFrame));
  const next = new Set<string>();
  for (const id of wantedIds) {
    if (admittedIds.has(id) || immediateIds.has(id)) {
      next.add(id);
    } else if (budget > 0) {
      next.add(id);
      budget -= 1;
    }
  }
  return next;
}

export type LiveScreenBootStatus = "booting" | "ready";

export function admitBootBudget({
  candidates,
  bootStatusById,
  bootBudget = OVERVIEW_LIVE_BOOT_BUDGET,
  costById,
  protectedIds,
}: {
  candidates: readonly string[];
  bootStatusById: ReadonlyMap<string, LiveScreenBootStatus>;
  bootBudget?: number;
  costById?: ReadonlyMap<string, number>;
  protectedIds: ReadonlySet<string>;
}): Set<string> {
  const admitted = new Set<string>();
  let bootingCount = 0;
  const limit = Math.max(0, Math.floor(bootBudget));
  const cost = (id: string) => Math.max(1, Math.floor(costById?.get(id) ?? 1));
  for (const id of candidates) {
    const status = bootStatusById.get(id);
    if (!status) continue;
    admitted.add(id);
    if (status === "booting") bootingCount += cost(id);
  }
  for (const id of candidates) {
    if (admitted.has(id)) continue;
    if (!protectedIds.has(id) && bootingCount + cost(id) > limit) continue;
    admitted.add(id);
    if (!protectedIds.has(id)) bootingCount += cost(id);
  }
  return admitted;
}

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
 *    preserving prior-live screens only while they overlap the raw viewport,
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
  visibleViewport,
  protectedScreenIds,
  previousLiveScreenIds,
  everVisibleScreenIds,
  lastVisibleEpochByScreenId,
  accessEpoch,
  liveScreenBudget = OVERVIEW_LIVE_SCREEN_BUDGET,
  liveIframeBudget = OVERVIEW_LIVE_IFRAME_CEILING,
}: {
  candidates: readonly ScreenCullCandidate[];
  viewport: OverscannedViewportBounds | null;
  /** The unexpanded camera viewport, used to keep overscan-only screens from
   *  displacing screens that have just entered the actual viewport. */
  visibleViewport: OverscannedViewportBounds | null;
  protectedScreenIds: ReadonlySet<string>;
  previousLiveScreenIds: ReadonlySet<string>;
  everVisibleScreenIds: ReadonlySet<string>;
  lastVisibleEpochByScreenId: ReadonlyMap<string, number>;
  accessEpoch: number;
  liveScreenBudget?: number;
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
  // no evictable screen is admitted until the interaction set shrinks again.
  const effectiveScreenBudget = Math.max(
    Math.max(0, Math.floor(liveScreenBudget)),
    nextLive.size,
  );
  const effectiveIframeBudget = Math.max(
    Math.max(0, Math.floor(liveIframeBudget)),
    mountedIframeCount,
  );
  const tryAddWithinBudget = (candidate: ScreenCullCandidate) => {
    if (nextLive.has(candidate.id)) return;
    if (nextLive.size + 1 > effectiveScreenBudget) return;
    if (
      mountedIframeCount + normalizedIframeCount(candidate) >
      effectiveIframeBudget
    ) {
      return;
    }
    add(candidate);
  };

  const visibleCandidates = candidates
    .filter(
      (candidate) =>
        viewportScreenIds.has(candidate.id) &&
        !protectedScreenIds.has(candidate.id),
    )
    .sort((a, b) => {
      if (!viewport) return a.id.localeCompare(b.id);
      // Keep the live pool stable while a camera move still overlaps the raw
      // viewport. The overscan halo is only a warm-ahead buffer, so an old
      // overscan-only screen must not displace a screen that just entered the
      // actual viewport.
      const previousLiveDelta =
        Number(
          previousLiveScreenIds.has(b.id) &&
            visibleViewport !== null &&
            isFrameWithinOverscannedViewport(b.geometry, visibleViewport),
        ) -
        Number(
          previousLiveScreenIds.has(a.id) &&
            visibleViewport !== null &&
            isFrameWithinOverscannedViewport(a.geometry, visibleViewport),
        );
      if (previousLiveDelta !== 0) return previousLiveDelta;
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

import { getRotatedFrameAABB } from "@shared/canvas-math";

import { SURFACE_PADDING } from "./overview-layout";
import type { FrameGeometry, Point } from "./types";


export const OVERVIEW_CULLING_ENABLED = true;

export const OVERVIEW_CULLING_OVERSCAN_FACTOR = 2;

export const OVERVIEW_LIVE_SCREEN_BUDGET = 32;

export const OVERVIEW_LIVE_IFRAME_CEILING = 96;

export const OVERVIEW_LIVE_BOOT_BUDGET = 4;

/** On-screen width (CSS px) below which an unprotected inline screen renders a
 * static preview instead of a live editor document. Nothing inside a frame
 * that small can be targeted, and every editor document carries the full
 * editor bridge, parsed and compiled on the editor's own main thread. */
export const OVERVIEW_LIVE_EDITOR_MIN_SCREEN_PX = 240;

const LIVE_EDITOR_DEMOTE_RATIO = 0.75;

export const OVERVIEW_STATIC_PREVIEW_BUDGET = 64;

export const OVERVIEW_STATIC_PREVIEW_OVERSCAN_FACTOR = 0.5;

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

export const OVERVIEW_IFRAME_ADMISSIONS_PER_FRAME = 8;

export const OVERVIEW_IFRAME_INSTANT_ADMISSION_MAX = 8;

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

  for (const candidate of candidates) {
    if (protectedScreenIds.has(candidate.id)) add(candidate);
  }
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

export interface OverscannedViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function getOverscannedViewportCanvasBounds(
  surfaceSize: { width: number; height: number },
  pan: Point,
  zoomPercent: number,
  overscanFactor: number = OVERVIEW_CULLING_OVERSCAN_FACTOR,
): OverscannedViewportBounds | null {
  if (surfaceSize.width <= 0 || surfaceSize.height <= 0) return null;
  const scale = zoomPercent / 100;
  if (!(scale > 0)) return null;
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

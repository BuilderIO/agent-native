import {
  getScreenContentCullState,
  isFrameWithinOverscannedViewport,
  type OverscannedViewportBounds,
  type ScreenCullTier,
} from "./culling";
import type { FrameGeometry } from "./types";

const SUPPRESSED_MARKER_ATTRIBUTE = "screenPaintSuppressed";

export interface ScreenPaintCandidate {
  id: string;
  geometry: FrameGeometry;
  tier: ScreenCullTier;
}

export interface ScreenPaintTarget {
  element: HTMLElement;
  screenId: string;
}

export function collectScreenPaintTargets(
  surface: HTMLElement | null,
): ScreenPaintTarget[] {
  if (!surface) return [];
  const targets: ScreenPaintTarget[] = [];
  surface
    .querySelectorAll<HTMLElement>("[data-screen-shell]")
    .forEach((element) => {
      const screenId = element.dataset.frameId;
      if (screenId) targets.push({ element, screenId });
    });
  return targets;
}

export function observeScreenPaintTargets(
  surface: HTMLElement | null,
  onChange: (targets: ScreenPaintTarget[]) => void,
): () => void {
  if (!surface) return () => {};

  const containsScreenPaintTarget = (node: Node) => {
    if (!(node instanceof Element)) return false;
    return (
      node.matches("[data-screen-shell]") ||
      node.querySelector("[data-screen-shell]") !== null
    );
  };
  const observer = new MutationObserver((records) => {
    let targetsMayHaveChanged = false;
    for (const record of records) {
      if (record.type === "attributes") {
        targetsMayHaveChanged = true;
        break;
      }
      for (const node of record.addedNodes) {
        if (containsScreenPaintTarget(node)) {
          targetsMayHaveChanged = true;
          break;
        }
      }
      if (targetsMayHaveChanged) break;
      for (const node of record.removedNodes) {
        if (containsScreenPaintTarget(node)) {
          targetsMayHaveChanged = true;
          break;
        }
      }
      if (targetsMayHaveChanged) break;
    }
    if (targetsMayHaveChanged) {
      onChange(collectScreenPaintTargets(surface));
    }
  });

  onChange(collectScreenPaintTargets(surface));
  observer.observe(surface, {
    attributes: true,
    attributeFilter: [
      "data-frame-id",
      "data-screen-content",
      "data-screen-shell",
    ],
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}

export function resolveSuppressedScreenIds(
  candidates: readonly ScreenPaintCandidate[],
  liveViewport: OverscannedViewportBounds | null,
  nearbyViewport: OverscannedViewportBounds | null = liveViewport,
  shellOutset = 0,
): Set<string> {
  const suppressed = new Set<string>();
  if (!liveViewport) return suppressed;
  const live = outsetViewport(liveViewport, shellOutset);
  const nearby = outsetViewport(nearbyViewport ?? liveViewport, shellOutset);
  for (const candidate of candidates) {
    if (candidate.tier === "visible") continue;
    const viewport = getScreenContentCullState(candidate.tier).isHidden
      ? live
      : nearby;
    if (isFrameWithinOverscannedViewport(candidate.geometry, viewport)) {
      continue;
    }
    suppressed.add(candidate.id);
  }
  return suppressed;
}

function outsetViewport(
  viewport: OverscannedViewportBounds,
  outset: number,
): OverscannedViewportBounds {
  if (outset === 0) return viewport;
  return {
    left: viewport.left - outset,
    top: viewport.top - outset,
    right: viewport.right + outset,
    bottom: viewport.bottom + outset,
  };
}

export function applyScreenPaintSuppression(
  targets: readonly ScreenPaintTarget[],
  suppressedScreenIds: ReadonlySet<string>,
  options?: { deferHide?: (screenId: string) => boolean },
): void {
  for (const { element, screenId } of targets) {
    const suppress = suppressedScreenIds.has(screenId);
    const applied = element.dataset[SUPPRESSED_MARKER_ATTRIBUTE] === "true";
    if (applied === suppress) continue;
    if (suppress) {
      if (options?.deferHide?.(screenId)) continue;
      element.dataset[SUPPRESSED_MARKER_ATTRIBUTE] = "true";
    } else {
      delete element.dataset[SUPPRESSED_MARKER_ATTRIBUTE];
    }
  }
}

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
    .querySelectorAll<HTMLElement>("[data-screen-content]")
    .forEach((element) => {
      const screenId = element.closest<HTMLElement>("[data-screen-shell]")
        ?.dataset.frameId;
      if (screenId) targets.push({ element, screenId });
    });
  return targets;
}

export function resolveSuppressedScreenIds(
  candidates: readonly ScreenPaintCandidate[],
  liveViewport: OverscannedViewportBounds | null,
): Set<string> {
  const suppressed = new Set<string>();
  if (!liveViewport) return suppressed;
  for (const candidate of candidates) {
    if (!getScreenContentCullState(candidate.tier).isHidden) continue;
    if (isFrameWithinOverscannedViewport(candidate.geometry, liveViewport)) {
      continue;
    }
    suppressed.add(candidate.id);
  }
  return suppressed;
}

export function applyScreenPaintSuppression(
  targets: readonly ScreenPaintTarget[],
  suppressedScreenIds: ReadonlySet<string>,
  options?: { relaxOnly?: boolean },
): void {
  for (const { element, screenId } of targets) {
    const suppress = suppressedScreenIds.has(screenId);
    const applied = element.dataset[SUPPRESSED_MARKER_ATTRIBUTE] === "true";
    if (applied === suppress) continue;
    if (options?.relaxOnly && suppress) continue;
    if (suppress) {
      element.style.setProperty("visibility", "hidden");
      element.dataset[SUPPRESSED_MARKER_ATTRIBUTE] = "true";
    } else {
      element.style.removeProperty("visibility");
      delete element.dataset[SUPPRESSED_MARKER_ATTRIBUTE];
    }
  }
}

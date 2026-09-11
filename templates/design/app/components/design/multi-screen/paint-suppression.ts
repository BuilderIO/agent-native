import {
  getScreenContentCullState,
  isFrameWithinOverscannedViewport,
  type OverscannedViewportBounds,
  type ScreenCullTier,
} from "./culling";
import type { FrameGeometry } from "./types";

// Zoom scales the world viewport rather than translating it, so no overscan
// covers a gesture's lag. React must never also write visibility here: its style
// diff would stop re-applying a value this owner has since cleared.

/** Lets a freshly mounted wrapper still be written while an unchanged one is
 *  skipped. */
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

/** Every content wrapper belonging to a screen, including its breakpoint
 *  previews — paint is decided per screen, so the whole shell moves together. */
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

/** Screens whose paint the browser may skip for the camera passed in. A
 *  `liveViewport` of `null` (surface not measured yet) suppresses nothing. */
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
    // Mid-gesture, only relax: hiding a screen the camera is still crossing
    // guarantees an unpainted frame when it returns.
    if (options?.relaxOnly && suppress) continue;
    if (suppress) {
      // Never content-visibility: it discards the subtree's rendering state, so
      // un-hiding blanks the iframe for a frame.
      element.style.setProperty("visibility", "hidden");
      element.dataset[SUPPRESSED_MARKER_ATTRIBUTE] = "true";
    } else {
      element.style.removeProperty("visibility");
      delete element.dataset[SUPPRESSED_MARKER_ATTRIBUTE];
    }
  }
}

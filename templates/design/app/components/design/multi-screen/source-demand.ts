import {
  isFrameWithinOverscannedViewport,
  OVERVIEW_LEGIBLE_SCREEN_PX,
  OVERVIEW_LIVE_SCREEN_BUDGET,
  OVERVIEW_STATIC_PREVIEW_BUDGET,
  orderByViewportDistance,
  type OverscannedViewportBounds,
} from "./culling";
import type { FrameGeometry } from "./types";

type ScreenIds = ReadonlySet<string>;

export interface SourceDemand {
  /** Sources the editor holds: required, protected and legible live screens. */
  pinned: string[];
  /** Sources for static previews, nearest the viewport first; evictable. */
  preview: string[];
}

/** Every screen that can paint at once: the live pool plus the static pool. */
export const SOURCE_PREVIEW_DEMAND_BUDGET =
  OVERVIEW_LIVE_SCREEN_BUDGET + OVERVIEW_STATIC_PREVIEW_BUDGET;

export function selectSourceDemand({
  frames,
  liveIds,
  protectedIds,
  zoom,
  requiredIds = new Set(),
  viewport = null,
  overscannedViewport = viewport,
  previewBudget = SOURCE_PREVIEW_DEMAND_BUDGET,
}: {
  frames: readonly { id: string; geometry: FrameGeometry }[];
  liveIds: ScreenIds;
  protectedIds: ScreenIds;
  zoom: number;
  requiredIds?: ScreenIds;
  /** What is on screen; none skips previews. */
  viewport?: OverscannedViewportBounds | null;
  /** Screens near the viewport, previewed after every on-screen one. */
  overscannedViewport?: OverscannedViewportBounds | null;
  previewBudget?: number;
}): SourceDemand {
  const protectedCandidates = [...protectedIds]
    .filter((id) => !requiredIds.has(id))
    .slice(0, OVERVIEW_LIVE_SCREEN_BUDGET);
  const protectedSet = new Set([...requiredIds, ...protectedCandidates]);
  const live = frames
    .filter(
      (frame) =>
        !protectedSet.has(frame.id) &&
        liveIds.has(frame.id) &&
        frame.geometry.width * zoom >= OVERVIEW_LEGIBLE_SCREEN_PX,
    )
    .slice(0, OVERVIEW_LIVE_SCREEN_BUDGET)
    .map((frame) => frame.id);
  const pinned = [...protectedSet, ...live];
  if (!viewport) return { pinned, preview: [] };
  const pinnedSet = new Set(pinned);
  const onScreen: (typeof frames)[number][] = [];
  const nearby: (typeof frames)[number][] = [];
  for (const frame of frames) {
    if (pinnedSet.has(frame.id)) continue;
    // Center distance alone ranks a tall on-screen screen behind short
    // off-screen ones, and the byte budget then sheds what is in view.
    if (isFrameWithinOverscannedViewport(frame.geometry, viewport)) {
      onScreen.push(frame);
    } else if (
      overscannedViewport &&
      isFrameWithinOverscannedViewport(frame.geometry, overscannedViewport)
    ) {
      nearby.push(frame);
    }
  }
  const preview = [
    ...orderByViewportDistance(onScreen, viewport),
    ...orderByViewportDistance(nearby, viewport),
  ].slice(0, Math.max(0, Math.floor(previewBudget)));
  return { pinned, preview };
}

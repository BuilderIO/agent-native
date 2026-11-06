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
  /**
   * Sources the editor holds: required, protected and legible live screens,
   * and screens painted on screen, which would blank if their source went.
   */
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
  paintedIds = new Set(),
  viewport = null,
  overscannedViewport = viewport,
  previewBudget = SOURCE_PREVIEW_DEMAND_BUDGET,
  previewOrder = "distance",
}: {
  /** `previewable: false` marks a screen that paints without its source. */
  frames: readonly {
    id: string;
    geometry: FrameGeometry;
    previewable?: boolean;
  }[];
  liveIds: ScreenIds;
  protectedIds: ScreenIds;
  zoom: number;
  requiredIds?: ScreenIds;
  /** Screens showing a loaded preview or editor. */
  paintedIds?: ScreenIds;
  /** What is on screen; none skips previews and painted screens. */
  viewport?: OverscannedViewportBounds | null;
  /** Screens near the viewport, previewed after every on-screen one. */
  overscannedViewport?: OverscannedViewportBounds | null;
  previewBudget?: number;
  /**
   * `board` keeps board order within each band, so the list changes only as
   * screens cross the viewport, not as the camera moves.
   */
  previewOrder?: "distance" | "board";
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
  if (!viewport) return { pinned: [...protectedSet, ...live], preview: [] };
  const liveSet = new Set(live);
  const painted = frames
    .filter(
      (frame) =>
        paintedIds.has(frame.id) &&
        !protectedSet.has(frame.id) &&
        !liveSet.has(frame.id) &&
        isFrameWithinOverscannedViewport(frame.geometry, viewport),
    )
    .map((frame) => frame.id);
  const pinned = [...protectedSet, ...live, ...painted];
  const pinnedSet = new Set(pinned);
  const onScreen: (typeof frames)[number][] = [];
  const nearby: (typeof frames)[number][] = [];
  for (const frame of frames) {
    if (pinnedSet.has(frame.id) || frame.previewable === false) continue;
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
  const order = (band: typeof frames) =>
    previewOrder === "board"
      ? band.map(({ id }) => id)
      : orderByViewportDistance(band, viewport);
  const preview = [...order(onScreen), ...order(nearby)].slice(
    0,
    Math.max(0, Math.floor(previewBudget)),
  );
  return { pinned, preview };
}

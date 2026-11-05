import { OVERVIEW_LIVE_SCREEN_BUDGET } from "./culling";

export function selectSourceDemand(
  frames: readonly { id: string; width: number }[],
  liveIds: ReadonlySet<string>,
  protectedIds: ReadonlySet<string>,
  zoom: number,
): string[] {
  const candidates = frames
    .filter(
      (frame) =>
        !protectedIds.has(frame.id) &&
        liveIds.has(frame.id) &&
        frame.width * zoom >= 64,
    )
    .slice(0, OVERVIEW_LIVE_SCREEN_BUDGET)
    .map((frame) => frame.id);
  return [...protectedIds, ...candidates].sort();
}

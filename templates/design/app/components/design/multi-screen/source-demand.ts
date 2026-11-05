import { OVERVIEW_LIVE_SCREEN_BUDGET } from "./culling";

export function selectSourceDemand(
  frames: readonly { id: string; width: number }[],
  liveIds: ReadonlySet<string>,
  protectedIds: ReadonlySet<string>,
  zoom: number,
  requiredIds: ReadonlySet<string> = new Set(),
): string[] {
  const protectedCandidates = [...protectedIds]
    .filter((id) => !requiredIds.has(id))
    .slice(0, OVERVIEW_LIVE_SCREEN_BUDGET);
  const protectedSet = new Set([...requiredIds, ...protectedCandidates]);
  const candidates = frames
    .filter(
      (frame) =>
        !protectedSet.has(frame.id) &&
        liveIds.has(frame.id) &&
        frame.width * zoom >= 64,
    )
    .slice(0, OVERVIEW_LIVE_SCREEN_BUDGET)
    .map((frame) => frame.id);
  return [...protectedSet, ...candidates].sort();
}

export type TouchSwipeDirection = "previous" | "next" | null;

const MIN_SWIPE_PX = 50;
const MAX_SWIPE_MS = 600;
const FLICK_VELOCITY_PX_MS = 0.4;
const MIN_FLICK_PX = 24;

export function getTouchSwipeDirection(
  dx: number,
  dy: number,
  duration: number,
): TouchSwipeDirection {
  if (Math.abs(dx) <= Math.abs(dy)) return null;

  const distance = Math.abs(dx);
  const velocity = distance / Math.max(duration, 1);
  const distanceCommit = distance >= MIN_SWIPE_PX && duration <= MAX_SWIPE_MS;
  const flickCommit =
    velocity >= FLICK_VELOCITY_PX_MS && distance >= MIN_FLICK_PX;
  if (!distanceCommit && !flickCommit) return null;

  return dx < 0 ? "next" : "previous";
}

export interface ScreenPoint {
  x: number;
  y: number;
}

const DIRECT_CLICK_MAX_TRAVEL_PX = 5;

export function isDirectPillClick(
  start: ScreenPoint | null,
  end: ScreenPoint,
): boolean {
  if (!start) return false;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  return (
    deltaX * deltaX + deltaY * deltaY <=
    DIRECT_CLICK_MAX_TRAVEL_PX * DIRECT_CLICK_MAX_TRAVEL_PX
  );
}

export type CrossScreenSKeyTimes = {
  downAt: number | null;
  upAt: number | null;
};

export function isCrossScreenIgnoreAutoLayoutHeldAtRelease(
  releasedAt: number | undefined,
  sKeyTimes: CrossScreenSKeyTimes,
  fallbackIgnoreAutoLayout: boolean,
): boolean {
  if (typeof releasedAt !== "number") {
    return fallbackIgnoreAutoLayout;
  }
  if (sKeyTimes.downAt === null) {
    return sKeyTimes.upAt === null || releasedAt < sKeyTimes.upAt
      ? fallbackIgnoreAutoLayout
      : false;
  }
  return (
    sKeyTimes.downAt <= releasedAt &&
    (sKeyTimes.upAt === null || releasedAt < sKeyTimes.upAt)
  );
}

export function shouldClearCrossScreenSKeyTimesOnWindowBlur(
  documentHasFocus: boolean,
): boolean {
  return !documentHasFocus;
}

export type CrossScreenSKeyTimes = {
  downAt: number | null;
  upAt: number | null;
};

export type CrossScreenModifierState = {
  metaKey?: boolean;
  ctrlKey?: boolean;
  ignoreAutoLayout?: boolean;
  forceNestedAutoLayout?: boolean;
};

export function seedCrossScreenSKeyTimesAtStart(
  sourceIgnoreAutoLayout: boolean,
  sKeyTimes: CrossScreenSKeyTimes,
  startedAt: number,
): CrossScreenSKeyTimes {
  if (
    !sourceIgnoreAutoLayout ||
    (sKeyTimes.upAt !== null && sKeyTimes.upAt >= startedAt)
  ) {
    return sKeyTimes;
  }
  return { downAt: startedAt, upAt: null };
}

export function mergeCrossScreenReleaseModifiers(
  cached: CrossScreenModifierState | undefined,
  release: CrossScreenModifierState | undefined,
): CrossScreenModifierState | undefined {
  if (!cached && !release) return undefined;
  return { ...cached, ...release };
}

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

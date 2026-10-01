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

export function crossScreenSKeyTimesAfterKeyChange(
  times: CrossScreenSKeyTimes,
  pressed: boolean,
  changedAt: number | undefined,
): CrossScreenSKeyTimes {
  if (typeof changedAt !== "number" || !Number.isFinite(changedAt)) {
    return times;
  }
  return pressed
    ? { downAt: changedAt, upAt: null }
    : { ...times, upAt: changedAt };
}

export function crossScreenReleaseModifiers(
  isApplePlatform: boolean,
  event: Pick<CrossScreenModifierState, "metaKey" | "ctrlKey">,
  ignoreAutoLayout?: boolean,
): CrossScreenModifierState {
  const metaKey = event.metaKey === true;
  const ctrlKey = event.ctrlKey === true;
  return {
    metaKey,
    ctrlKey,
    ...(ignoreAutoLayout === undefined ? {} : { ignoreAutoLayout }),
    forceNestedAutoLayout: isApplePlatform
      ? metaKey && !ctrlKey
      : ctrlKey && !metaKey,
  };
}

export function isCrossScreenIgnoreAutoLayoutHeldAtRelease(
  releasedAt: number | undefined,
  sKeyTimes: CrossScreenSKeyTimes,
  fallbackIgnoreAutoLayout: boolean,
  hostReleaseIgnoreAutoLayout?: boolean,
): boolean {
  if (typeof hostReleaseIgnoreAutoLayout === "boolean") {
    return hostReleaseIgnoreAutoLayout;
  }
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

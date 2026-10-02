export type CrossScreenSKeyTimes = {
  downAt: number | null;
  upAt: number | null;
};

export function isCrossScreenModifierFromActiveSourceIframe(
  activeSourceIframeId: string | undefined,
  senderIframeId: string | undefined,
): boolean {
  return (
    activeSourceIframeId !== undefined &&
    activeSourceIframeId === senderIframeId
  );
}

export function crossScreenSKeyHeldFromTimes(
  times: CrossScreenSKeyTimes,
): boolean | null {
  if (times.downAt === null && times.upAt === null) return null;
  return (
    times.downAt !== null && (times.upAt === null || times.downAt > times.upAt)
  );
}

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
  const latestChangeAt = Math.max(
    times.downAt ?? Number.NEGATIVE_INFINITY,
    times.upAt ?? Number.NEGATIVE_INFINITY,
  );
  if (changedAt < latestChangeAt) return times;
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
  const ignoreAutoLayoutAtRelease = isApplePlatform
    ? ctrlKey && !metaKey
    : ignoreAutoLayout;
  return {
    metaKey,
    ctrlKey,
    ...(ignoreAutoLayoutAtRelease === undefined
      ? {}
      : { ignoreAutoLayout: ignoreAutoLayoutAtRelease }),
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

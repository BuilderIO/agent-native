export type DashboardAdoptionHold = {
  dashboardId: string;
  minUpdatedAtMs: number | null;
  expiresAt: number;
};

type PrefetchSnapshotLike<T> = {
  data: T;
  syncVersion: number;
};

export function dashboardPrefetchInitialData<T>(
  snapshot: PrefetchSnapshotLike<T> | undefined,
  syncVersion: number,
): T | undefined {
  if (!snapshot || snapshot.syncVersion !== syncVersion) return undefined;
  return snapshot.data;
}

export function dashboardUpdatedAtMs(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function createDashboardAdoptionHold({
  dashboardId,
  currentUpdatedAt,
  now = Date.now(),
  ttlMs = 10_000,
}: {
  dashboardId: string;
  currentUpdatedAt: string | null;
  now?: number;
  ttlMs?: number;
}): DashboardAdoptionHold {
  const currentUpdatedAtMs = dashboardUpdatedAtMs(currentUpdatedAt);
  return {
    dashboardId,
    minUpdatedAtMs: currentUpdatedAtMs ?? now,
    expiresAt: now + ttlMs,
  };
}

export function shouldAdoptDashboardQueryResult({
  dashboardId,
  loaded,
  isPlaceholderData,
  fetchedId,
  fetchedUpdatedAt,
  currentUpdatedAt,
  hold,
  now = Date.now(),
}: {
  dashboardId: string | undefined;
  loaded: boolean;
  isPlaceholderData: boolean;
  fetchedId: string | null | undefined;
  fetchedUpdatedAt: string | null | undefined;
  currentUpdatedAt: string | null;
  hold: DashboardAdoptionHold | null;
  now?: number;
}): { adopt: boolean; clearHold: boolean } {
  if (!dashboardId) return { adopt: false, clearHold: false };
  if (loaded && isPlaceholderData) {
    return { adopt: false, clearHold: false };
  }
  if (fetchedId && fetchedId !== dashboardId) {
    return { adopt: false, clearHold: false };
  }

  const fetchedMs = dashboardUpdatedAtMs(fetchedUpdatedAt);
  const currentMs = dashboardUpdatedAtMs(currentUpdatedAt);
  const activeHold = hold?.dashboardId === dashboardId ? hold : null;
  const clearHold = !!activeHold && now >= activeHold.expiresAt;

  if (activeHold && !clearHold && activeHold.minUpdatedAtMs !== null) {
    if (fetchedMs === null || fetchedMs <= activeHold.minUpdatedAtMs) {
      return { adopt: false, clearHold: false };
    }
    return { adopt: true, clearHold: true };
  }

  if (currentMs !== null && fetchedMs !== null && fetchedMs < currentMs) {
    return { adopt: false, clearHold };
  }

  return { adopt: true, clearHold };
}

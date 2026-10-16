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

export function shouldShowDashboardLoadError({
  dashboardId,
  isError,
  loaded,
  hasDashboard,
}: {
  dashboardId: string | null;
  isError: boolean;
  loaded: boolean;
  hasDashboard: boolean;
}): boolean {
  return Boolean(dashboardId && isError && (!loaded || !hasDashboard));
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

/**
 * The hold left after a save fails. The save gives up only the hold it placed:
 * by now a later save, a live collaborative update, or another dashboard may
 * hold the page instead, and that hold stays.
 */
export function releaseDashboardAdoptionHold(
  current: DashboardAdoptionHold | null,
  placed: DashboardAdoptionHold | null,
): DashboardAdoptionHold | null {
  return current === placed ? null : current;
}

/**
 * The page's version after one of its saves lands. A save moves it only on the
 * dashboard it saved, and only from the version it was sent against. If the
 * page has moved on since (it adopted someone else's save, undid one, or
 * switched dashboards), a late result is older news and the page keeps what it
 * has. Two dashboards can have the same version, so the version alone doesn't
 * say which one the page is on.
 */
export function dashboardVersionAfterSave(
  page: { dashboardId: string | undefined; updatedAt: string | null },
  save: {
    dashboardId: string;
    sentAgainst: string | undefined;
    saved: string | undefined;
  },
): string | null {
  return save.saved !== undefined &&
    page.dashboardId === save.dashboardId &&
    (page.updatedAt ?? undefined) === save.sentAgainst
    ? save.saved
    : page.updatedAt;
}

export function shouldAdoptDashboardQueryResult({
  dashboardId,
  loaded,
  isPlaceholderData,
  fetchedId,
  fetchedUpdatedAt,
  currentUpdatedAt,
  hold,
  savesPending,
  now = Date.now(),
}: {
  dashboardId: string | undefined;
  loaded: boolean;
  isPlaceholderData: boolean;
  fetchedId: string | null | undefined;
  fetchedUpdatedAt: string | null | undefined;
  /** The newest version the page knows, including its own saves that landed. */
  currentUpdatedAt: string | null;
  hold: DashboardAdoptionHold | null;
  /** Whether a save for this dashboard is queued or in flight. */
  savesPending: boolean;
  now?: number;
}): { adopt: boolean; clearHold: boolean } {
  if (!dashboardId) return { adopt: false, clearHold: false };
  if (loaded && isPlaceholderData) {
    return { adopt: false, clearHold: false };
  }
  if (fetchedId && fetchedId !== dashboardId) {
    return { adopt: false, clearHold: false };
  }
  // No fetch can hold a save that hasn't landed, and adopting one that holds
  // an earlier queued save drops the later edits on screen.
  if (savesPending) return { adopt: false, clearHold: false };

  const fetchedMs = dashboardUpdatedAtMs(fetchedUpdatedAt);
  const currentMs = dashboardUpdatedAtMs(currentUpdatedAt);
  const activeHold = hold?.dashboardId === dashboardId ? hold : null;
  const expired = !!activeHold && now >= activeHold.expiresAt;
  const floorMs = activeHold && !expired ? activeHold.minUpdatedAtMs : null;

  if (floorMs !== null && (fetchedMs === null || fetchedMs <= floorMs)) {
    return { adopt: false, clearHold: false };
  }
  if (currentMs !== null && fetchedMs !== null && fetchedMs < currentMs) {
    return { adopt: false, clearHold: expired };
  }

  return { adopt: true, clearHold: expired || floorMs !== null };
}

import type { InboxSyncAccountStatus } from "@shared/inbox-threads.js";

import type { SyncAccountRow } from "./inbox-store.js";

// The one place a stored sync row becomes a status, so the sync step and the
// list read report the same state: pending work, degraded reads, errors.
export function statusFromRow(row: SyncAccountRow): InboxSyncAccountStatus {
  const backfillPending =
    row.fullSyncPageToken != null ||
    row.fullSyncPhase === "reconcile" ||
    row.hydratePendingIds.length > 0 ||
    row.archivePendingIds.length > 0 ||
    row.archiveHistoryPending;
  const degradedCount =
    row.degraded.hydrate.length + row.degraded.verify.length;
  const degraded =
    degradedCount > 0
      ? {
          degraded: {
            count: degradedCount,
            kind: row.degraded.kind ?? "unknown",
          },
        }
      : {};
  if (row.status === "needs_reauth" || row.status === "error") {
    return {
      accountEmail: row.accountEmail,
      state: row.status,
      lastSyncedAt: row.lastSyncedAt,
      error: row.lastError ?? undefined,
      ...(backfillPending ? { backfillPending: true } : {}),
      ...degraded,
    };
  }
  return {
    accountEmail: row.accountEmail,
    // An archive stream with unread pages is as unfinished as a first sync.
    state:
      row.historyId == null ||
      row.status === "syncing" ||
      row.archiveHistoryPending
        ? "initial"
        : "ready",
    lastSyncedAt: row.lastSyncedAt,
    ...(backfillPending ? { backfillPending: true } : {}),
    ...degraded,
  };
}

const STATE_RANK: Record<InboxSyncAccountStatus["state"], number> = {
  ready: 0,
  initial: 1,
  error: 2,
  needs_reauth: 3,
};

// Two steps of one call report one status: the most conservative reading of
// both (an error beats initial beats ready; pending or degraded if either is).
export function mergeSyncStatuses(
  first: InboxSyncAccountStatus,
  second: InboxSyncAccountStatus,
): InboxSyncAccountStatus {
  const worse =
    STATE_RANK[first.state] > STATE_RANK[second.state] ? first : second;
  const degraded =
    (first.degraded?.count ?? 0) > (second.degraded?.count ?? 0)
      ? first.degraded
      : (second.degraded ?? first.degraded);
  const error = worse.error ?? first.error ?? second.error;
  return {
    ...second,
    state: worse.state,
    ...(error ? { error } : {}),
    ...(first.backfillPending || second.backfillPending
      ? { backfillPending: true }
      : {}),
    ...(degraded ? { degraded } : {}),
  };
}

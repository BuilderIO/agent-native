import type { InboxSyncAccountStatus } from "@shared/inbox-threads.js";

import type { SyncAccountRow } from "./inbox-store.js";

// The one place a stored sync row becomes a status, so the sync step and the
// list read report the same state: pending work, degraded reads, errors.
export function statusFromRow(row: SyncAccountRow): InboxSyncAccountStatus {
  const backfillPending =
    row.fullSyncPageToken != null ||
    row.fullSyncPhase === "reconcile" ||
    row.hydratePendingIds.length > 0 ||
    row.archivePendingIds.length > 0;
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
    state:
      row.historyId == null || row.status === "syncing" ? "initial" : "ready",
    lastSyncedAt: row.lastSyncedAt,
    ...(backfillPending ? { backfillPending: true } : {}),
    ...degraded,
  };
}

import type { InboxSyncAccountStatus } from "@shared/inbox-threads.js";

import { pushWatchState } from "./inbox-push-watch.js";
import type { SyncAccountRow } from "./inbox-store.js";

// The one place a stored sync row becomes a status, so the sync step and the
// list read report the same state: pending work, degraded reads, errors.
export function statusFromRow(row: SyncAccountRow): InboxSyncAccountStatus {
  const backfillPending =
    row.fullSyncPageToken != null ||
    row.fullSyncPhase === "reconcile" ||
    row.hydratePendingIds.length > 0 ||
    // Archive candidates whose hydration is itself failing are degraded, not
    // work the next step will complete.
    row.archivePendingIds.some((id) => !row.degraded.hydrate.includes(id)) ||
    row.archiveHistoryPending;
  const pushWatch = pushWatchState(row, Date.now());
  const corruptCount = Object.keys(row.corrupt).length;
  const degradedCount =
    row.degraded.hydrate.length + row.degraded.verify.length + corruptCount;
  // Unreadable stored state outranks every read failure: it is never reported
  // as "nothing pending".
  const degraded =
    degradedCount > 0
      ? {
          degraded: {
            count: degradedCount,
            kind:
              corruptCount > 0
                ? "corrupt_state"
                : (row.degraded.kind ?? "unknown"),
          },
        }
      : {};
  if (row.status === "needs_reauth" || row.status === "error") {
    return {
      accountEmail: row.accountEmail,
      state: row.status,
      lastSyncedAt: row.lastSyncedAt,
      error: row.lastError ?? undefined,
      pushWatch,
      ...(backfillPending ? { backfillPending: true } : {}),
      ...(row.inboxCapped ? { reachedCap: true } : {}),
      ...degraded,
    };
  }
  return {
    accountEmail: row.accountEmail,
    // An archive stream with unread pages is as unfinished as a first sync.
    state:
      row.historyId == null ||
      row.status === "syncing" ||
      row.historyPending ||
      row.archiveHistoryPending
        ? "initial"
        : "ready",
    lastSyncedAt: row.lastSyncedAt,
    pushWatch,
    ...(backfillPending ? { backfillPending: true } : {}),
    ...(row.inboxCapped ? { reachedCap: true } : {}),
    ...degraded,
  };
}

/**
 * Work the next sync step still has to do or retry. A steady account has none,
 * so the freshness gate must not treat it as fresh while any is outstanding.
 */
export function hasOutstandingSyncWork(
  row: SyncAccountRow,
  now: number,
): boolean {
  // Corrupt state is a diagnostic: it shows in the status but is not work, so it
  // never defeats the freshness gate. A failing id counts only once its retry is
  // due; between retries a permanent failure costs no Gmail calls.
  return (
    row.historyPending ||
    row.archiveHistoryPending ||
    row.hydratePendingIds.length > 0 ||
    row.archivePendingIds.length > 0 ||
    row.degraded.hydrate.some((id) => retryDue(row.degraded, "h", id, now)) ||
    row.degraded.verify.some((id) => retryDue(row.degraded, "v", id, now))
  );
}

const RETRY_BACKOFF_BASE_MS = 60_000;
const RETRY_BACKOFF_MAX_MS = 6 * 60 * 60_000;

/** Exponential wait before attempt `count + 1` of a failing id. */
export function retryBackoffMs(count: number): number {
  return Math.min(
    RETRY_BACKOFF_MAX_MS,
    RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, count - 1),
  );
}

/** Whether a failing id's next attempt is due (an id with no entry is due). */
export function retryDue(
  degraded: SyncAccountRow["degraded"],
  list: "h" | "v",
  id: string,
  now: number,
): boolean {
  const entry = degraded.attempts?.[`${list}:${id}`];
  return entry === undefined || entry.nextAt <= now;
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
    ...(first.reachedCap || second.reachedCap ? { reachedCap: true } : {}),
    ...(degraded ? { degraded } : {}),
  };
}

// Stored state that could not be read outranks every other degraded reading,
// whichever step produced the status.
export function withCorruptState(
  status: InboxSyncAccountStatus,
  corrupt: SyncAccountRow["corrupt"],
): InboxSyncAccountStatus {
  const count = Object.keys(corrupt).length;
  if (count === 0) return status;
  return {
    ...status,
    degraded: {
      count: Math.max(count, status.degraded?.count ?? 0),
      kind: "corrupt_state",
    },
  };
}

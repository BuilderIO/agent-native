import {
  INBOX_SYNC_POLL_MS,
  type InboxPushWatch,
} from "@shared/inbox-threads.js";

/**
 * Gmail watch renewals run every 6h (`WATCH_RENEW_INTERVAL_MS` in mail-jobs).
 * Two missed renewals mean the watch is no longer being kept alive, so the
 * account falls back to the short poll instead of going stale silently.
 */
const PUSH_WATCH_STALE_MS = 12 * 60 * 60_000;

/**
 * `lastWatchRenewedAt` is only ever written when push is configured, so a
 * null value covers both "no push configured" and "never renewed".
 */
export function pushWatchState(
  row: { lastWatchRenewedAt: number | null },
  now: number,
): InboxPushWatch {
  return row.lastWatchRenewedAt != null &&
    now - row.lastWatchRenewedAt < PUSH_WATCH_STALE_MS
    ? "active"
    : "fallback";
}

/** How old a steady account's last sync may be before a poll syncs it again. */
export function steadyPollMaxAgeMs(
  row: { lastWatchRenewedAt: number | null },
  now: number,
): number {
  return pushWatchState(row, now) === "active"
    ? INBOX_SYNC_POLL_MS.pushActive
    : INBOX_SYNC_POLL_MS.fallback;
}

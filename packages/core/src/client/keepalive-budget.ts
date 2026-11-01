// Browsers refuse a keepalive request once the keepalive bodies in flight from
// the page pass 64 KiB, counted in encoded bytes. Action calls and application
// state writes share that allowance here. A page's last document save is an
// action call, so actions come first: application state only takes what is
// left after keeping room for one more action body of the largest size, and a
// write that doesn't fit goes without keepalive instead.

export const KEEPALIVE_PAGE_LIMIT_BYTES = 64 * 1024;

/** The most body bytes keepalive action calls may have in flight at once. */
export const ACTION_KEEPALIVE_BODY_BUDGET_BYTES = 48_000;

export type KeepaliveSender = "action" | "app-state";

let actionBytes = 0;
let appStateBytes = 0;

/** The body bytes a keepalive request from this sender can take right now. */
export function availableKeepaliveBytes(sender: KeepaliveSender): number {
  const free = KEEPALIVE_PAGE_LIMIT_BYTES - actionBytes - appStateBytes;
  const actionRoom = ACTION_KEEPALIVE_BODY_BUDGET_BYTES - actionBytes;
  return sender === "action"
    ? Math.min(free, actionRoom)
    : free - Math.max(0, actionRoom);
}

/**
 * Holds `bytes` of the page's keepalive allowance until the returned release
 * runs, or returns undefined when they don't fit.
 */
export function reserveKeepaliveBytes(
  sender: KeepaliveSender,
  bytes: number,
): (() => void) | undefined {
  if (bytes > availableKeepaliveBytes(sender)) return undefined;
  if (sender === "action") actionBytes += bytes;
  else appStateBytes += bytes;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (sender === "action") actionBytes -= bytes;
    else appStateBytes -= bytes;
  };
}

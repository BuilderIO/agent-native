/**
 * Application-state keys the server stores once per browser tab: a request
 * for `navigation` from tab `t1` reads and writes the row `navigation:t1`.
 * The client needs the same list to know that `navigation` and
 * `navigation:t1` are one row.
 */
export const TAB_SCOPED_APP_STATE_KEYS: ReadonlySet<string> = new Set([
  "navigation",
  "navigate",
  "__url__",
  "__set_url__",
  "settings-view",
  "pending-selection-context",
]);

/**
 * Set on every answer from the batch write route, so a client can tell that
 * the route ran, and its writes may have landed, from a server without it.
 */
export const APP_STATE_BATCH_ROUTE_HEADER = "X-Agent-Native-App-State-Batch";

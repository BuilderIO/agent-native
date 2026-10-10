/**
 * Set to `allow` on a GET action response whose result the browser may keep in
 * its persisted query cache. The client persists only when it reads this value,
 * so a response without it stays out of the cache, including from a server
 * that predates the header.
 */
export const ACTION_BROWSER_PERSIST_HEADER = "X-Agent-Native-Browser-Persist";
export const ACTION_BROWSER_PERSIST_ALLOW = "allow";

import { getAppConfig } from "../app-config/index.js";
import type { BrowserTabTarget } from "../server/request-context.js";
import { BROWSER_TAB_USED_APP_STATE_KEY } from "../shared/app-state-routes.js";
import { appStateListUpdatedAt } from "./store.js";

/** How long after its last use a tab still counts as the one to act on. */
export const LAST_USED_BROWSER_TAB_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const SAFE_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

// Several apps can share one database (Design and Slides do), so each app
// keeps its tabs' records under its own name. The browser's write and the
// MCP lookup both run in this app's server, so they name it the same way.
function appScope(): string {
  const app = getAppConfig().app;
  const name =
    app.workspaceId ?? app.id ?? app.slug ?? app.packageName ?? app.name;
  return name?.replace(/[^A-Za-z0-9_-]/g, "-") || "app";
}

function browserTabUsedKeyPrefix(): string {
  return `${BROWSER_TAB_USED_APP_STATE_KEY}:${appScope()}:`;
}

/** The row that records a tab's last use: one per app and tab. */
export function browserTabUsedKey(browserTabId: string): string {
  return `${browserTabUsedKeyPrefix()}${browserTabId}`;
}

/**
 * The tab of this app the user used last, if one was used within
 * LAST_USED_BROWSER_TAB_MAX_AGE_MS. Tabs are ordered by when the server
 * stored their use, so browser clocks don't matter.
 */
export async function findLastUsedBrowserTab(
  sessionId: string,
  now = Date.now(),
): Promise<BrowserTabTarget> {
  const prefix = browserTabUsedKeyPrefix();
  let best: { tabId: string; usedAt: number } | undefined;
  for (const { key, updatedAt } of await appStateListUpdatedAt(
    sessionId,
    prefix,
  )) {
    const tabId = key.slice(prefix.length);
    if (!SAFE_TAB_ID_RE.test(tabId)) continue;
    if (!Number.isFinite(updatedAt)) continue;
    if (now - updatedAt > LAST_USED_BROWSER_TAB_MAX_AGE_MS) continue;
    if (!best || updatedAt > best.usedAt) best = { tabId, usedAt: updatedAt };
  }
  return best ? { kind: "last-used", ...best } : { kind: "unavailable" };
}

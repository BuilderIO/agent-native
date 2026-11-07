import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { getRequestRunContext } from "@agent-native/core/server/request-context";

import {
  appStateKeyForBrowserTab,
  normalizeBrowserTabId,
} from "../shared/app-state-tabs.js";

/** The browser tab the current request came from, if any. */
export function getCurrentRequestBrowserTabId(): string | null {
  return normalizeBrowserTabId(getRequestRunContext()?.browserTabId);
}

/**
 * The tab whose state the current request reads and writes: the tab it came
 * from or, for an MCP call from no tab, the tab of this app the user used
 * last. Null when there is neither.
 */
export async function getCurrentRequestStateTabId(): Promise<string | null> {
  const run = getRequestRunContext();
  const browserTabId = normalizeBrowserTabId(run?.browserTabId);
  if (browserTabId) return browserTabId;
  const target = await run?.browserTabTarget?.resolve();
  return target?.kind === "last-used"
    ? normalizeBrowserTabId(target.tabId)
    : null;
}

async function appStateKeyForCurrentTab(key: string): Promise<string> {
  return appStateKeyForBrowserTab(key, await getCurrentRequestStateTabId());
}

export async function readAppStateForCurrentTab(
  key: string,
  options?: { fallbackToGlobal?: boolean },
): Promise<Record<string, unknown> | null> {
  const tabKey = await appStateKeyForCurrentTab(key);
  if (tabKey !== key) {
    const scoped = await readAppState(tabKey).catch(() => null);
    if (scoped) return scoped;
    if (options?.fallbackToGlobal === false) return null;
  }
  return readAppState(key);
}

export async function writeAppStateForCurrentTab(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  await writeAppState(await appStateKeyForCurrentTab(key), value);
}

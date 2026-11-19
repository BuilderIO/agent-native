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

// `unavailable` marks an MCP call that looked for a recently used tab and
// found none, as opposed to a request that has no tab to look for.
async function currentStateTab(): Promise<{
  tabId: string | null;
  unavailable: boolean;
}> {
  const run = getRequestRunContext();
  const browserTabId = normalizeBrowserTabId(run?.browserTabId);
  if (browserTabId) return { tabId: browserTabId, unavailable: false };
  const target = await run?.browserTabTarget?.resolve();
  if (!target) return { tabId: null, unavailable: false };
  const tabId =
    target.kind === "last-used" ? normalizeBrowserTabId(target.tabId) : null;
  return { tabId, unavailable: !tabId };
}

/**
 * The tab whose state the current request reads and writes: the tab it came
 * from or, for an MCP call from no tab, the tab of this app the user used
 * last. Null when there is neither.
 */
export async function getCurrentRequestStateTabId(): Promise<string | null> {
  return (await currentStateTab()).tabId;
}

export async function readAppStateForCurrentTab(
  key: string,
  options?: { fallbackToGlobal?: boolean },
): Promise<Record<string, unknown> | null> {
  const { tabId, unavailable } = await currentStateTab();
  const tabKey = appStateKeyForBrowserTab(key, tabId);
  if (tabKey !== key) {
    const scoped = await readAppState(tabKey);
    if (scoped) return scoped;
    if (options?.fallbackToGlobal === false) return null;
  } else if (unavailable && options?.fallbackToGlobal !== true) {
    // No tab keeps the account-wide row current, so an MCP call that found
    // none reads it only when the caller asks for it.
    return null;
  }
  return readAppState(key);
}

export async function writeAppStateForCurrentTab(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  const { tabId } = await currentStateTab();
  await writeAppState(appStateKeyForBrowserTab(key, tabId), value);
}

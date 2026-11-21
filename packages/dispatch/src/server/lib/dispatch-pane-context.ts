import {
  readAppState,
  appStateKeyForBrowserTab,
  resolveCurrentRequestStateTab,
} from "@agent-native/core/application-state";

import {
  CHAT_FIRST_PANE_CONTEXT_STATE_KEY,
  isDispatchChildBrowserTabId,
} from "../../shared/chat-first-pane.js";

/**
 * Resolve only the child claimed by the current Dispatch tab, for the
 * installation that has already passed the current MCP grant check.
 */
export async function readDispatchPaneContext() {
  const tab = await resolveCurrentRequestStateTab();
  if (!tab.tabId || tab.unavailable) return null;
  return readAppState(
    appStateKeyForBrowserTab(CHAT_FIRST_PANE_CONTEXT_STATE_KEY, tab.tabId),
  );
}

export async function resolveDispatchChildBrowserTab(target: {
  id: string;
  url: string;
  homeUrl?: string;
}): Promise<string | undefined> {
  const pane = await readDispatchPaneContext();
  if (
    pane?.appId !== target.id ||
    typeof pane.origin !== "string" ||
    typeof pane.observedAt !== "number" ||
    Date.now() - pane.observedAt > 30 * 60_000 ||
    !isDispatchChildBrowserTabId(pane.childBrowserTabId)
  ) {
    return undefined;
  }
  try {
    const origin = new URL(target.homeUrl ?? target.url).origin;
    return pane.origin === origin ? pane.childBrowserTabId : undefined;
  } catch {
    // coercion-ok: An invalid installation origin cannot authorize a child binding.
    return undefined;
  }
}

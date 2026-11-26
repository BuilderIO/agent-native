import { fail } from "@agent-native/core/action";
import {
  readAppState,
  appStateKeyForBrowserTab,
  resolveCurrentRequestStateTab,
} from "@agent-native/core/application-state";

import {
  CHAT_FIRST_PANE_BINDING_MAX_AGE_MS,
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
    !isDispatchChildBrowserTabId(pane.childBrowserTabId)
  ) {
    return undefined;
  }
  const runtimeUrl = target.homeUrl ?? target.url;
  if (!URL.canParse(runtimeUrl) || pane.origin !== new URL(runtimeUrl).origin) {
    return undefined;
  }
  if (
    typeof pane.observedAt !== "number" ||
    !Number.isFinite(pane.observedAt) ||
    Date.now() - pane.observedAt > CHAT_FIRST_PANE_BINDING_MAX_AGE_MS
  ) {
    fail("The visible app tab could not be reached. Reopen it and retry.", {
      errorCode: "dispatch_pane_tab_unavailable",
      statusCode: 409,
    });
  }
  return pane.childBrowserTabId;
}

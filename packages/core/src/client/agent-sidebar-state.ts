import {
  AGENT_SIDEBAR_QUERY_PARAM,
  AGENT_SIDEBAR_QUERY_VALUE_CLOSED,
} from "../shared/agent-sidebar-url.js";

export const SIDEBAR_OPEN_KEY = "agent-native-sidebar-open";
export const SIDEBAR_STATE_CHANGE_EVENT = "agent-panel:state-change";
export const SIDEBAR_URL_CHANGE_EVENT = "agent-panel:url-change";

const HISTORY_PATCHED_KEY = "__agentNativeSidebarHistoryPatched";

export type AgentSidebarStateSource = "app" | "frame";
export type AgentSidebarStateMode = "app" | "code";

export interface AgentSidebarStateChangeDetail {
  /** Whether the user-visible agent panel is open. */
  open: boolean;
  /** Which surface owns the visible agent panel. */
  source: AgentSidebarStateSource;
  /** Frame protocol mode: "code" is parent-owned, "app" is app-owned. */
  mode: AgentSidebarStateMode;
}

export function getAgentSidebarOpenPreferenceKey(
  storageKey?: string | null,
): string {
  const suffix = storageKey?.trim();
  return suffix ? `agent-native.${suffix}.sidebar-open` : SIDEBAR_OPEN_KEY;
}

export function dispatchAgentSidebarStateChange(
  detail: AgentSidebarStateChangeDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AgentSidebarStateChangeDetail>(SIDEBAR_STATE_CHANGE_EVENT, {
      detail,
    }),
  );
}

export function setAgentSidebarOpenPreference(
  open: boolean,
  storageKey?: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      getAgentSidebarOpenPreferenceKey(storageKey),
      String(open),
    );
  } catch {}
}

export function requestAgentSidebarOpen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("agent-panel:open"));
}

export function getAgentSidebarUrlOpenOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get(AGENT_SIDEBAR_QUERY_PARAM);
    if (value === AGENT_SIDEBAR_QUERY_VALUE_CLOSED) return false;
  } catch {}
  return null;
}

export function consumeAgentSidebarUrlOpenOverride(
  storageKey?: string | null,
): boolean | null {
  const override = getAgentSidebarUrlOpenOverride();
  if (override === null || typeof window === "undefined") return override;

  setAgentSidebarOpenPreference(override, storageKey);

  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(AGENT_SIDEBAR_QUERY_PARAM);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {}

  return override;
}

function emitSidebarUrlChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SIDEBAR_URL_CHANGE_EVENT));
}

function installSidebarUrlChangeEvents(): void {
  if (typeof window === "undefined") return;
  const historyWithFlag = window.history as History & {
    [HISTORY_PATCHED_KEY]?: boolean;
  };
  if (historyWithFlag[HISTORY_PATCHED_KEY]) return;

  const pushState = window.history.pushState;
  const replaceState = window.history.replaceState;

  window.history.pushState = function pushStateWithSidebarEvent(...args) {
    const result = pushState.apply(this, args);
    emitSidebarUrlChange();
    return result;
  };
  window.history.replaceState = function replaceStateWithSidebarEvent(...args) {
    const result = replaceState.apply(this, args);
    emitSidebarUrlChange();
    return result;
  };
  historyWithFlag[HISTORY_PATCHED_KEY] = true;
}

export function subscribeAgentSidebarUrlChanges(
  listener: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  installSidebarUrlChangeEvents();
  window.addEventListener(SIDEBAR_URL_CHANGE_EVENT, listener);
  window.addEventListener("popstate", listener);
  window.addEventListener("hashchange", listener);

  return () => {
    window.removeEventListener(SIDEBAR_URL_CHANGE_EVENT, listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener("hashchange", listener);
  };
}

export function getInitialAgentSidebarOpen(
  defaultOpen: boolean,
  storageKey?: string | null,
): boolean {
  const urlOverride = getAgentSidebarUrlOpenOverride();
  if (urlOverride !== null) return urlOverride;

  // On mobile viewports the sidebar would cover most of the screen, so
  // always start closed regardless of any persisted desktop preference.
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px)").matches
  ) {
    return false;
  }

  try {
    const saved = localStorage.getItem(
      getAgentSidebarOpenPreferenceKey(storageKey),
    );
    if (saved === "false") return false;
    // Never let durable storage turn on a sidebar that is default-closed.
    // Programmatic chat handoffs open the current sidebar transiently instead.
    if (defaultOpen && saved === "true") return true;
  } catch {}
  return defaultOpen;
}

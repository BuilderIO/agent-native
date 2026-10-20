import {
  AGENT_SIDEBAR_QUERY_PARAM,
  AGENT_SIDEBAR_QUERY_VALUE_CLOSED,
  AGENT_SIDEBAR_QUERY_VALUE_OPEN,
} from "../shared/agent-sidebar-url.js";
import { hasChatThreadDeepLink } from "./chat-thread-url.js";

export { hasChatThreadDeepLink } from "./chat-thread-url.js";

export const SIDEBAR_OPEN_KEY = "agent-native-sidebar-open";
export const SIDEBAR_STATE_CHANGE_EVENT = "agent-panel:state-change";
export const SIDEBAR_URL_CHANGE_EVENT = "agent-panel:url-change";
export const AGENT_SIDEBAR_MIN_WIDTH = 280;
export const AGENT_SIDEBAR_DEFAULT_MAX_WIDTH = 700;
export const AGENT_SIDEBAR_WIDE_WIDTH_RATIO = 0.75;

const HISTORY_PATCHED_KEY = "__agentNativeSidebarHistoryPatched";

export type AgentSidebarStateSource = "app" | "frame";
export type AgentSidebarStateMode = "app" | "code";

export interface AgentSidebarStateChangeDetail {
  open: boolean;
  source: AgentSidebarStateSource;
  mode: AgentSidebarStateMode;
}

function resolveViewportWidth(viewportWidth?: number): number {
  const resolved =
    viewportWidth ??
    (typeof window === "undefined"
      ? AGENT_SIDEBAR_DEFAULT_MAX_WIDTH
      : window.innerWidth);
  if (!Number.isFinite(resolved)) {
    throw new TypeError("Agent sidebar viewport width must be finite");
  }
  return Math.max(0, resolved);
}

export function getAgentSidebarWideWidth(viewportWidth?: number): number {
  return Math.max(
    AGENT_SIDEBAR_MIN_WIDTH,
    Math.round(
      resolveViewportWidth(viewportWidth) * AGENT_SIDEBAR_WIDE_WIDTH_RATIO,
    ),
  );
}

export function getAgentSidebarMaxWidth(viewportWidth?: number): number {
  return Math.max(
    AGENT_SIDEBAR_DEFAULT_MAX_WIDTH,
    getAgentSidebarWideWidth(viewportWidth),
  );
}

export function clampAgentSidebarWidth(
  width: number,
  viewportWidth?: number,
): number {
  if (!Number.isFinite(width)) {
    throw new TypeError("Agent sidebar width must be finite");
  }
  return Math.min(
    getAgentSidebarMaxWidth(viewportWidth),
    Math.max(AGENT_SIDEBAR_MIN_WIDTH, width),
  );
}

export function getAgentSidebarOpenPreferenceKey(
  storageKey?: string | null,
): string {
  const suffix = storageKey?.trim();
  return suffix ? `agent-native.${suffix}.sidebar-open` : SIDEBAR_OPEN_KEY;
}

function getExplicitUrlOpenSessionKey(storageKey?: string | null): string {
  return `${getAgentSidebarOpenPreferenceKey(storageKey)}.explicit-url-open`;
}

function getExplicitUrlOpenSessionIntent(
  storageKey?: string | null,
): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      window.sessionStorage.getItem(
        getExplicitUrlOpenSessionKey(storageKey),
      ) === "true"
    );
  } catch {
    // coercion-ok: null distinguishes unreadable storage from a missing false intent.
    return null;
  }
}

function setExplicitUrlOpenSessionIntent(
  open: boolean,
  storageKey?: string | null,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const key = getExplicitUrlOpenSessionKey(storageKey);
    if (open) {
      window.sessionStorage.setItem(key, "true");
    } else {
      window.sessionStorage.removeItem(key);
    }
    return true;
  } catch {
    // coercion-ok: false keeps the explicit URL intent available when the session write fails.
    return false;
  }
}

function writeAgentSidebarOpenPreference(
  open: boolean,
  storageKey?: string | null,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      getAgentSidebarOpenPreferenceKey(storageKey),
      String(open),
    );
    return true;
  } catch {
    // coercion-ok: false keeps the URL override retryable when preference persistence fails.
    return false;
  }
}

function replaceAgentSidebarUrlOpenOverride(open: boolean | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    if (open === null) {
      url.searchParams.delete(AGENT_SIDEBAR_QUERY_PARAM);
    } else {
      url.searchParams.set(
        AGENT_SIDEBAR_QUERY_PARAM,
        open
          ? AGENT_SIDEBAR_QUERY_VALUE_OPEN
          : AGENT_SIDEBAR_QUERY_VALUE_CLOSED,
      );
    }
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl === currentUrl) return true;
    window.history.replaceState(window.history.state, "", nextUrl);
    return true;
  } catch {
    // coercion-ok: false tells the caller the URL intent could not be updated.
    return false;
  }
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
): boolean {
  if (typeof window === "undefined") return false;
  const urlOverride = getAgentSidebarUrlOpenOverride();
  const sessionIntentSaved =
    urlOverride !== null || !open
      ? setExplicitUrlOpenSessionIntent(open, storageKey)
      : true;
  const preferenceSaved = writeAgentSidebarOpenPreference(open, storageKey);
  const storageSaved = sessionIntentSaved && preferenceSaved;
  if (urlOverride !== null || !storageSaved) {
    let urlOverrideSaved = replaceAgentSidebarUrlOpenOverride(
      storageSaved ? null : open,
    );
    if (storageSaved && !urlOverrideSaved) {
      urlOverrideSaved = replaceAgentSidebarUrlOpenOverride(open);
    }
    return storageSaved && urlOverrideSaved;
  }
  return storageSaved;
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
    if (value === AGENT_SIDEBAR_QUERY_VALUE_OPEN) return true;
  } catch {}
  return null;
}

export function consumeAgentSidebarUrlOpenOverride(
  storageKey?: string | null,
): boolean | null {
  const override = getAgentSidebarUrlOpenOverride();
  if (override === null || typeof window === "undefined") return override;

  const preferenceSaved = writeAgentSidebarOpenPreference(override, storageKey);
  const sessionIntentSaved = setExplicitUrlOpenSessionIntent(
    override,
    storageKey,
  );
  if (!preferenceSaved || !sessionIntentSaved) return override;

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

  const pushState = window.history.pushState.bind(window.history);
  const replaceState = window.history.replaceState.bind(window.history);

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
  { ignoreUrlOverride = false }: { ignoreUrlOverride?: boolean } = {},
): boolean {
  if (!ignoreUrlOverride) {
    const urlOverride = getAgentSidebarUrlOpenOverride();
    if (urlOverride !== null) return urlOverride;
  }
  if (getExplicitUrlOpenSessionIntent(storageKey) === true) {
    try {
      if (
        window.localStorage.getItem(
          getAgentSidebarOpenPreferenceKey(storageKey),
        ) !== "false"
      ) {
        return true;
      }
    } catch {
      return true;
    }
  }
  if (hasChatThreadDeepLink()) return true;

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
    if (defaultOpen && saved === "true") return true;
  } catch {}
  return defaultOpen;
}

import { useEffect } from "react";

import { BROWSER_TAB_USED_APP_STATE_KEY } from "../shared/app-state-routes.js";
import {
  deleteClientAppState,
  setClientAppState,
} from "./application-state.js";
import { getBrowserTabId } from "./browser-tab-id.js";

// While the tab keeps focus, moving around in it refreshes its record at most
// this often. Coming back to the tab from elsewhere always records it.
const ROUTE_CHANGE_RECORD_INTERVAL_MS = 60_000;

let mounts = 0;
let removeListeners: (() => void) | undefined;
let lastRecordedAt = 0;
// Whether focus has left the page (to another tab, window or app) since the
// last record. Focus moving into one of the page's own frames doesn't count.
let leftSinceRecorded = true;

function hasFocus(): boolean {
  try {
    return typeof document !== "undefined" && document.hasFocus();
  } catch {
    return false;
  }
}

function record(): void {
  lastRecordedAt = Date.now();
  leftSinceRecorded = false;
  try {
    void setClientAppState(
      BROWSER_TAB_USED_APP_STATE_KEY,
      { usedAt: lastRecordedAt },
      { requestSource: getBrowserTabId() },
    ).catch(() => {});
  } catch {
    // Apps without the agent-native API have nothing to record.
  }
}

function recordIfReturned(): void {
  if (
    leftSinceRecorded ||
    Date.now() - lastRecordedAt >= ROUTE_CHANGE_RECORD_INTERVAL_MS
  ) {
    record();
  }
}

function forget(): void {
  leftSinceRecorded = true;
  try {
    void deleteClientAppState(BROWSER_TAB_USED_APP_STATE_KEY, {
      keepalive: true,
      requestSource: getBrowserTabId(),
    }).catch(() => {});
  } catch {
    // Nothing was recorded.
  }
}

function listen(): () => void {
  if (
    typeof window.addEventListener !== "function" ||
    typeof document === "undefined" ||
    typeof document.addEventListener !== "function"
  ) {
    return () => {};
  }
  const onFocus = () => recordIfReturned();
  const onBlur = () => {
    // Focus moving into one of the page's frames blurs the window, but the
    // page still has focus once it settles.
    setTimeout(() => {
      if (!hasFocus()) leftSinceRecorded = true;
    }, 0);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") leftSinceRecorded = true;
    else if (hasFocus()) recordIfReturned();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted && hasFocus()) record();
  };
  const onPageHide = () => forget();
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("pagehide", onPageHide);
  };
}

/**
 * Records when someone uses this browser tab (it gains focus, or its route
 * changes while focused) and forgets the tab when the page goes away. An MCP
 * tool call comes from no tab, so the server points its tab-scoped app
 * state (navigation, navigate commands, selection) at the tab of this app
 * used last. `useAgentRouteState` calls it; an app with its own navigation
 * sync calls it once with its current route.
 */
export function useBrowserTabUse(route: string, enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    mounts += 1;
    if (mounts === 1) {
      removeListeners = listen();
      if (hasFocus()) record();
    }
    return () => {
      mounts -= 1;
      if (mounts === 0) {
        removeListeners?.();
        removeListeners = undefined;
      }
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (hasFocus()) recordIfReturned();
  }, [enabled, route]);
}

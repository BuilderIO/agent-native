import { useEffect, useRef } from "react";

import { BROWSER_TAB_USED_APP_STATE_KEY } from "../shared/app-state-routes.js";
import {
  deleteClientAppState,
  setClientAppState,
} from "./application-state.js";
import { getBrowserTabId } from "./browser-tab-id.js";

const FOCUS_RECORD_INTERVAL_MS = 60_000;

let mounts = 0;
let removeListeners: (() => void) | undefined;
let lastRecordedAt = 0;
// Whether focus has left the page (to another tab, window or app) since the
// last record. Focus moving into one of the page's own frames doesn't count.
let leftSinceRecorded = true;

function isVisible(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState !== "hidden"
  );
}

function hasFocus(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.hasFocus === "function" &&
    document.hasFocus()
  );
}

// A record that fails to save leaves the tab unfindable, and the MCP call
// then says no tab was used, so a failed write needs no handling here.
function record(): void {
  lastRecordedAt = Date.now();
  leftSinceRecorded = false;
  void setClientAppState(
    BROWSER_TAB_USED_APP_STATE_KEY,
    { usedAt: lastRecordedAt },
    { requestSource: getBrowserTabId() },
  ).catch(() => {});
}

function recordIfReturned(): void {
  if (
    leftSinceRecorded ||
    Date.now() - lastRecordedAt >= FOCUS_RECORD_INTERVAL_MS
  ) {
    record();
  }
}

// A lost delete leaves the record to expire after
// LAST_USED_BROWSER_TAB_MAX_AGE_MS.
function forget(): void {
  leftSinceRecorded = true;
  void deleteClientAppState(BROWSER_TAB_USED_APP_STATE_KEY, {
    keepalive: true,
    requestSource: getBrowserTabId(),
  }).catch(() => {});
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
    else recordIfReturned();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted && isVisible()) record();
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
 * Records the tab on visible mount, visibility, focus and route changes.
 * Forgets it when the page goes away. An MCP
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
      if (isVisible()) record();
    }
    return () => {
      mounts -= 1;
      if (mounts === 0) {
        removeListeners?.();
        removeListeners = undefined;
      }
    };
  }, [enabled]);

  const previousRoute = useRef(route);
  useEffect(() => {
    const changedRoute = previousRoute.current !== route;
    previousRoute.current = route;
    if (enabled && changedRoute && isVisible()) record();
  }, [enabled, route]);
}

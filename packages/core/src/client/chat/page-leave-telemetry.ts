import { getActiveRun } from "../active-run-state.js";
import { currentRouteTemplate } from "../route-template.js";

const PAGE_LEAVE_TRACKING_STATE_KEY = Symbol.for(
  "agent-native.client.agentChatPageLeaveTracking",
);

interface PageLeaveTrackingState {
  pageLeft: boolean;
}

type PageLeaveTrackingWindow = Window & {
  [PAGE_LEAVE_TRACKING_STATE_KEY]?: PageLeaveTrackingState;
};

/** Installs one content-free page-exit event per visible page lifetime. */
export function installAgentChatPageLeaveTracking(
  send: (name: string, properties: Record<string, unknown>) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const target = window as PageLeaveTrackingWindow;
  if (target[PAGE_LEAVE_TRACKING_STATE_KEY]) return () => {};

  const state: PageLeaveTrackingState = { pageLeft: false };
  target[PAGE_LEAVE_TRACKING_STATE_KEY] = state;
  const onPageHide = (event?: PageTransitionEvent) => {
    if (state.pageLeft) return;
    state.pageLeft = true;
    const route = currentRouteTemplate();
    send("agent_chat_page_left", {
      active_run: Boolean(getActiveRun()),
      ...(route ? { route_template: route } : {}),
      bfcache_persisted: event?.persisted === true,
    });
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) state.pageLeft = false;
  };
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);

  return () => {
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    if (target[PAGE_LEAVE_TRACKING_STATE_KEY] === state) {
      delete target[PAGE_LEAVE_TRACKING_STATE_KEY];
    }
  };
}

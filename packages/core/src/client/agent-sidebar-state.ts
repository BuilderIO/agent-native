import { isInBuilderFrame } from "./builder-frame.js";

export const SIDEBAR_OPEN_KEY = "agent-native-sidebar-open";
export const SIDEBAR_STATE_CHANGE_EVENT = "agent-panel:state-change";

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

export function getInitialAgentSidebarOpen(defaultOpen: boolean): boolean {
  // On mobile viewports the sidebar would cover most of the screen, so
  // always start closed regardless of any persisted desktop preference.
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px)").matches
  ) {
    return false;
  }

  // Builder owns the code/chat surface around embedded apps. Start the
  // app-native chat collapsed there even if a previous standalone session
  // persisted it as open.
  if (isInBuilderFrame()) {
    return false;
  }

  try {
    const saved = localStorage.getItem(SIDEBAR_OPEN_KEY);
    if (saved !== null) return saved === "true";
  } catch {}
  return defaultOpen;
}

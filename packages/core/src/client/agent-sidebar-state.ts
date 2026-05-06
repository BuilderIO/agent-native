import { isInBuilderFrame } from "./builder-frame.js";

export const SIDEBAR_OPEN_KEY = "agent-native-sidebar-open";

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

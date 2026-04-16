/**
 * Client helpers for pages rendered inside an agent-chat `embed` iframe.
 *
 * Embedded pages are sandboxed, same-origin iframes mounted by `IframeEmbed`.
 * They usually want a "pop out" button that takes the user to the same URL
 * in the main app window. `postNavigate` handles that — when running inside
 * an embed it posts a message to the parent, which updates the parent's URL
 * without reloading. When running standalone (not in an iframe) it falls
 * back to a same-window navigation.
 */

export const AGENT_NAVIGATE_MESSAGE_TYPE = "agent-native:navigate";

export interface AgentNavigateMessage {
  type: typeof AGENT_NAVIGATE_MESSAGE_TYPE;
  path: string;
}

function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

/**
 * Navigate the main app window to the given same-origin path.
 *
 * Accepts paths beginning with `/`. Absolute URLs are rejected — embeds
 * should not be able to steer the parent to arbitrary origins.
 */
export function postNavigate(path: string): void {
  if (typeof window === "undefined") return;
  if (typeof path !== "string" || !path.startsWith("/")) return;
  if (!isEmbedded()) {
    window.location.href = path;
    return;
  }
  const message: AgentNavigateMessage = {
    type: AGENT_NAVIGATE_MESSAGE_TYPE,
    path,
  };
  window.parent.postMessage(message, window.location.origin);
}

/**
 * True when the current page is running inside an agent-chat embed iframe.
 * Use to show/hide "Open in main window" buttons.
 */
export function isInAgentEmbed(): boolean {
  return isEmbedded();
}

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

export function postNavigate(path: string): void {
  if (typeof window === "undefined") return;
  if (typeof path !== "string" || !path.startsWith("/")) return;
  if (!isEmbedded()) {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current !== path) {
      const previous: unknown = window.history.state;
      const previousIdx =
        previous && typeof previous === "object" && "idx" in previous
          ? previous.idx
          : undefined;
      const nextState =
        typeof previousIdx === "number"
          ? {
              usr: null,
              key: Math.random().toString(36).slice(2, 10),
              idx: previousIdx + 1,
            }
          : null;
      window.history.pushState(nextState, "", path);
      window.dispatchEvent(new PopStateEvent("popstate", { state: nextState }));
    }
    return;
  }
  const message: AgentNavigateMessage = {
    type: AGENT_NAVIGATE_MESSAGE_TYPE,
    path,
  };
  window.parent.postMessage(message, window.location.origin);
}

export function isInAgentEmbed(): boolean {
  return isEmbedded();
}

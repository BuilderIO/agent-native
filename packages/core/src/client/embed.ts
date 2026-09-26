
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
    window.location.href = path;
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

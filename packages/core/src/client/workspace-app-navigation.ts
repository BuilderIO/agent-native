export const AGENT_NATIVE_WORKSPACE_APP_ROUTE_MESSAGE_TYPE =
  "agent-native:workspace-app-route" as const;

export interface AgentNativeWorkspaceAppRouteMessage {
  type: typeof AGENT_NATIVE_WORKSPACE_APP_ROUTE_MESSAGE_TYPE;
  path: string;
}

function normalizeWorkspaceAppRoute(path: string): string | null {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//")
  ) {
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;

  try {
    const url = new URL(path, "http://agent-native.invalid");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // coercion-ok: malformed route input is not reported to the host.
    return null;
  }
}

/**
 * Report an app-local route to its immediate embedding host. The host checks
 * the iframe source and origin before applying the route to its own URL.
 */
export function postAgentNativeWorkspaceAppRoute(path: string): boolean {
  if (typeof window === "undefined") return false;
  const parentWindow = window.parent;
  if (!parentWindow || parentWindow === window) return false;

  const normalizedPath = normalizeWorkspaceAppRoute(path);
  if (!normalizedPath) return false;

  const message: AgentNativeWorkspaceAppRouteMessage = {
    type: AGENT_NATIVE_WORKSPACE_APP_ROUTE_MESSAGE_TYPE,
    path: normalizedPath,
  };
  parentWindow.postMessage(message, "*");
  return true;
}

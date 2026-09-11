/**
 * Route contract for the Dispatch → workspace app agent-chat proxy.
 *
 * When an app is open in Dispatch, its chat rail must talk to that app's own
 * agent (its tools, its AGENTS.md and skills, its org resources, its dev-mode
 * surface) instead of to Dispatch's agent. The rail points `apiUrl` at this
 * Dispatch-side prefix and the server forwards the whole agent-chat subtree to
 * the app's `/_agent-native/agent-chat`, exactly as the Desktop loopback relay
 * does. Shared so the browser can build the URL without importing server code.
 */

export const WORKSPACE_APP_CHAT_PROXY_PREFIX =
  "/_agent-native/workspace-app-chat";

/** Dispatch-relative base URL the chat rail uses as its `apiUrl`. */
export function workspaceAppChatProxyPath(appId: string): string {
  return `${WORKSPACE_APP_CHAT_PROXY_PREFIX}/${encodeURIComponent(appId.trim())}`;
}

/**
 * Split `/<appId>[/rest]` off a request that already matched the prefix.
 * Returns null when there is no app segment, so the route fails loudly instead
 * of proxying to an unresolved target.
 */
export function parseWorkspaceAppChatProxyPath(
  pathname: string,
): { appId: string; targetSubPath: string } | null {
  const index = pathname.indexOf(WORKSPACE_APP_CHAT_PROXY_PREFIX);
  if (index < 0) return null;
  const rest = pathname.slice(index + WORKSPACE_APP_CHAT_PROXY_PREFIX.length);
  if (!rest.startsWith("/")) return null;
  const segments = rest.slice(1).split("/");
  const rawAppId = segments.shift() ?? "";
  let appId: string;
  try {
    appId = decodeURIComponent(rawAppId).trim();
  } catch {
    // coercion-ok: malformed percent-encoding names no workspace app.
    return null;
  }
  if (!appId) return null;
  const targetSubPath = segments.length > 0 ? `/${segments.join("/")}` : "";
  if (targetSubPath.includes("..")) return null;
  return { appId, targetSubPath };
}

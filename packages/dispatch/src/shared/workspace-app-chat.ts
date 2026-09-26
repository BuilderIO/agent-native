export const WORKSPACE_APP_CHAT_PROXY_PREFIX =
  "/_agent-native/workspace-app-chat";

export function workspaceAppChatProxyPath(appId: string): string {
  return `${WORKSPACE_APP_CHAT_PROXY_PREFIX}/${encodeURIComponent(appId.trim())}`;
}

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

/** Server-minted authority for a workspace host's chat proxy, never a document session. */
export const WORKSPACE_APP_CHAT_SCOPE = "capability:workspace-app-chat";
export const WORKSPACE_APP_CHAT_TTL_SECONDS = 15 * 60;

export function isWorkspaceAppChatScope(
  scope: string | null | undefined,
): boolean {
  return scope === WORKSPACE_APP_CHAT_SCOPE;
}

/** Deliberately excludes provider keys, mode writes, sharing, and worker dispatch. */
export function workspaceAppChatAllowsRequest(
  path: string,
  method: string,
): boolean {
  const prefix = "/_agent-native/agent-chat";
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return false;
  const tail = path.slice(prefix.length);
  if (method === "POST" && tail === "") return true;
  if (
    method === "GET" &&
    [
      "/mode",
      "/capabilities",
      "/threads",
      "/runs/active",
      "/runs/latest",
    ].includes(tail)
  )
    return true;
  if (method === "POST" && tail === "/threads") return true;
  const id = "[A-Za-z0-9_-]+";
  if (method === "GET" && new RegExp(`^/threads/${id}(?:/runs)?$`).test(tail))
    return true;
  if (method === "PUT" && new RegExp(`^/threads/${id}$`).test(tail))
    return true;
  if (
    method === "POST" &&
    new RegExp(
      `^/threads/${id}/(?:queued|approval-resolution|rename|pin|hide|archive|fork)$`,
    ).test(tail)
  )
    return true;
  if (
    method === "GET" &&
    new RegExp(`^/runs/${id}/(?:events|background-events)$`).test(tail)
  )
    return true;
  if (
    method === "POST" &&
    new RegExp(`^/runs/(?:${id}/(?:stop|abort)|turn/${id}/abort)$`).test(tail)
  )
    return true;
  return false;
}

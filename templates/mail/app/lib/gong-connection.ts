import type { McpServersList } from "@agent-native/core/client/resources";

export function canManageGongConnection(
  servers: McpServersList | undefined,
): boolean {
  if (!servers) return false;
  if (servers.orgId === null) return true;
  return servers.role === "owner" || servers.role === "admin";
}

export function hasConnectedGongMcpServer(
  servers: McpServersList | undefined,
): boolean {
  if (!servers) return false;
  return [...servers.user, ...servers.org].some(
    (server) => server.status.state === "connected" && isGongMcpUrl(server.url),
  );
}

function isGongMcpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://mcp.gong.io" &&
      url.pathname.replace(/\/+$/, "") === "/mcp"
    );
  } catch {
    return false;
  }
}

export const MCP_PUBLIC_ROUTE_PREFIX = "/mcp";
export const MCP_LEGACY_ROUTE_PREFIX = "/_agent-native/mcp";

export const MCP_ROUTE_PREFIXES = [
  MCP_LEGACY_ROUTE_PREFIX,
  MCP_PUBLIC_ROUTE_PREFIX,
] as const;

export function joinMcpRoute(prefix: string, suffix: string): string {
  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${prefix}${normalizedSuffix}` || normalizedSuffix;
}

export function isMcpPublicPath(pathname: string): boolean {
  return (
    pathname === MCP_PUBLIC_ROUTE_PREFIX ||
    pathname.startsWith(`${MCP_PUBLIC_ROUTE_PREFIX}/`)
  );
}

export function isMcpProtocolPath(pathname: string): boolean {
  return (
    pathname === MCP_PUBLIC_ROUTE_PREFIX ||
    pathname === MCP_LEGACY_ROUTE_PREFIX ||
    pathname === `${MCP_PUBLIC_ROUTE_PREFIX}/` ||
    pathname === `${MCP_LEGACY_ROUTE_PREFIX}/`
  );
}

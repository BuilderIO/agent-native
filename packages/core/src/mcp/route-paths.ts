export const MCP_PUBLIC_ROUTE_PREFIX = "/mcp";
export const MCP_DIRECTORY_ROUTE_PREFIX = "/mcp/directory";
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
    pathname === MCP_DIRECTORY_ROUTE_PREFIX ||
    pathname === `${MCP_PUBLIC_ROUTE_PREFIX}/` ||
    pathname === `${MCP_LEGACY_ROUTE_PREFIX}/` ||
    pathname === `${MCP_DIRECTORY_ROUTE_PREFIX}/`
  );
}

/**
 * A browser opening the public MCP URL as a page, which the app's own `/mcp`
 * route answers. An MCP client never navigates, and its GET stream asks for
 * `text/event-stream`.
 */
export function isMcpPageNavigation(
  pathname: string,
  method: string,
  header: (name: string) => string | null | undefined,
): boolean {
  if (
    pathname !== MCP_PUBLIC_ROUTE_PREFIX &&
    pathname !== `${MCP_PUBLIC_ROUTE_PREFIX}/`
  ) {
    return false;
  }
  if (method !== "GET" && method !== "HEAD") return false;
  const accept = header("accept")?.toLowerCase() ?? "";
  if (accept.includes("text/event-stream")) return false;
  const fetchDest = header("sec-fetch-dest")?.toLowerCase();
  return fetchDest ? fetchDest === "document" : accept.includes("text/html");
}

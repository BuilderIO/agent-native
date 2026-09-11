import { getChunkedCookie, getCookie, type H3Event } from "h3";

import { decryptSecretValue } from "../secrets/crypto.js";

export const MCP_OAUTH_FLOW_COOKIE = "an_mcp_oauth_flow";
export const MCP_OAUTH_FLOW_COOKIE_CHUNK_SIZE = 2_800;
export const MCP_OAUTH_FLOW_COOKIE_MAX_CHUNKS = 8;

const CHUNKED_COOKIE_PREFIX = "__chunked__";

export type McpOAuthFlowCookieReadResult =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "ok"; value: Record<string, unknown> };

/** Read the encrypted MCP flow without coupling callback relays to OAuth routes. */
export function readMcpOAuthFlowCookiePayload(
  event: H3Event,
): McpOAuthFlowCookieReadResult {
  const primaryCookie = getCookie(event, MCP_OAUTH_FLOW_COOKIE);
  if (!primaryCookie) return { status: "absent" };
  if (primaryCookie.startsWith(CHUNKED_COOKIE_PREFIX)) {
    const rawCount = primaryCookie.slice(CHUNKED_COOKIE_PREFIX.length);
    if (!/^\d+$/.test(rawCount)) return { status: "invalid" };
    const chunkCount = Number(rawCount);
    if (chunkCount < 2 || chunkCount > MCP_OAUTH_FLOW_COOKIE_MAX_CHUNKS) {
      return { status: "invalid" };
    }
  }

  const encrypted = getChunkedCookie(event, MCP_OAUTH_FLOW_COOKIE);
  if (!encrypted) return { status: "invalid" };
  try {
    const parsed: unknown = JSON.parse(decryptSecretValue(encrypted));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "invalid" };
    }
    return { status: "ok", value: parsed as Record<string, unknown> };
  } catch {
    return { status: "invalid" };
  }
}

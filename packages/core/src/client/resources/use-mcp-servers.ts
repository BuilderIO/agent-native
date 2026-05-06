/**
 * React-query hooks for remote MCP servers surfaced inside the Workspace
 * tab as a virtual `mcp-servers/` folder.
 *
 * MCP servers live in the settings store (user- and org-scope), not the
 * resources table. These hooks wrap the existing `/_agent-native/mcp/servers`
 * endpoints so the Workspace UI can list, create, and delete them with the
 * same keys/invalidations the old Settings panel used.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "../api-path.js";

export type McpServerScope = "user" | "org";

export interface McpServer {
  id: string;
  scope: McpServerScope;
  name: string;
  url: string;
  headers?: Record<string, { set: true }>;
  description?: string;
  createdAt: number;
  mergedId: string;
  status:
    | { state: "connected"; toolCount: number }
    | { state: "error"; error: string }
    | { state: "unknown" };
}

export interface McpServersList {
  user: McpServer[];
  org: McpServer[];
  orgId: string | null;
  role: string | null;
}

const ENDPOINT = agentNativePath("/_agent-native/mcp/servers");
const LIST_KEY = ["mcp-servers"] as const;

export function useMcpServers() {
  return useQuery<McpServersList>({
    queryKey: LIST_KEY,
    queryFn: async () => {
      const res = await fetch(ENDPOINT, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      return (await res.json()) as McpServersList;
    },
    staleTime: 10_000,
  });
}

export interface CreateMcpServerArgs {
  scope: McpServerScope;
  name: string;
  url: string;
  headers?: Record<string, string>;
  description?: string;
}

export function useCreateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateMcpServerArgs) => {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        server?: McpServer;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Create failed (${res.status})`);
      }
      return body.server!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; scope: McpServerScope }) => {
      const res = await fetch(
        `${ENDPOINT}/${encodeURIComponent(args.id)}?scope=${args.scope}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Delete failed (${res.status})`);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export interface TestMcpUrlResult {
  ok: boolean;
  error?: string;
  toolCount?: number;
  tools?: string[];
}

export function getMcpUrlValidationError(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "Enter the Streamable HTTP MCP server URL.";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "Enter a full URL, including https://.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "MCP server URLs must start with https://.";
  }
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    return "Use https:// for remote MCP servers. Plain http:// is only allowed for localhost.";
  }
  return null;
}

export function formatMcpServerError(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error ?? "");
  const text = raw.trim();
  if (!text) return "Could not connect to that MCP server.";
  if (
    /<!doctype|<html[\s>]|<\/html>|unexpected token '<'|is not valid json/i.test(
      text,
    )
  ) {
    return "That URL returned a web page instead of an MCP response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.";
  }
  if (/streamable http/i.test(text) && /error|failed|non-200|status/i.test(text)) {
    return "The server did not complete the Streamable HTTP MCP handshake. Check the URL and any required authorization headers.";
  }
  if (/failed to fetch|fetch failed|networkerror|econnrefused|enotfound|timed out/i.test(text)) {
    return "Could not reach that MCP server. Check the URL and make sure it is publicly reachable from this app.";
  }
  if (/401|403|unauthorized|forbidden/i.test(text)) {
    return "The MCP server rejected the request. Add or update the required Authorization header.";
  }
  if (/404|not found|405|method not allowed/i.test(text)) {
    return "That URL is reachable, but it does not look like the MCP endpoint. Check the server's Streamable HTTP path.";
  }
  return text.length > 240 ? `${text.slice(0, 237).trimEnd()}...` : text;
}

export async function testMcpServerUrl(
  url: string,
  headers?: Record<string, string>,
): Promise<TestMcpUrlResult> {
  const validationError = getMcpUrlValidationError(url);
  if (validationError) return { ok: false, error: validationError };
  const res = await fetch(`${ENDPOINT}/test`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, headers }),
  });
  const body = (await res.json().catch(() => ({}))) as TestMcpUrlResult;
  if (!res.ok) {
    return {
      ok: false,
      error: formatMcpServerError(body.error || "Test failed"),
    };
  }
  return body.ok === false
    ? { ...body, error: formatMcpServerError(body.error) }
    : body;
}

/**
 * Virtual tree-node id used when a server is surfaced in the Workspace tree.
 * Shape: `mcp:<scope>:<serverId>`. Not a real resource row; purely a handle
 * the panel uses to route clicks/delete back to the MCP endpoints.
 */
export function mcpVirtualId(scope: McpServerScope, serverId: string): string {
  return `mcp:${scope}:${serverId}`;
}

export function parseMcpVirtualId(
  id: string,
): { scope: McpServerScope; serverId: string } | null {
  const m = /^mcp:(user|org):(.+)$/.exec(id);
  if (!m) return null;
  return { scope: m[1] as McpServerScope, serverId: m[2] };
}

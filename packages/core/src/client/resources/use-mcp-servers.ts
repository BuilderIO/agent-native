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

const ENDPOINT = "/_agent-native/mcp/servers";
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
        { method: "DELETE", credentials: "include" },
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

export async function testMcpServerUrl(
  url: string,
  headers?: Record<string, string>,
): Promise<TestMcpUrlResult> {
  const res = await fetch(`${ENDPOINT}/test`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, headers }),
  });
  const body = (await res.json().catch(() => ({}))) as TestMcpUrlResult;
  if (!res.ok) return { ok: false, error: body.error || "Test failed" };
  return body;
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

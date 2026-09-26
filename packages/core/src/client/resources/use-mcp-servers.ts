
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  type ReactNode,
} from "react";

import { agentNativePath } from "../api-path.js";
import { useAfterPaint } from "../use-after-paint.js";
import { hasPendingMcpConnection } from "./mcp-connection-refresh.js";
import { addMcpConnectionCompleteListener } from "./mcp-connection-resume.js";

export type McpServerScope = "user" | "org";

export interface McpServer {
  id: string;
  scope: McpServerScope;
  name: string;
  url: string;
  headers?: Record<string, { set: true }>;
  authMode: "none" | "headers" | "oauth";
  description?: string;
  firstParty?: boolean;
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

export interface McpServersApi {
  list: () => Promise<McpServersList>;
  create: (args: CreateMcpServerArgs) => Promise<McpServer>;
  delete: (args: { id: string; scope: McpServerScope }) => Promise<void>;
  reconnect: (args: ReconnectMcpServerArgs) => Promise<void>;
  test: (
    url: string,
    headers?: Record<string, string>,
  ) => Promise<TestMcpUrlResult>;
  testExisting: (args: {
    id: string;
    scope: McpServerScope;
  }) => Promise<TestMcpUrlResult>;
}

const McpServersApiContext = createContext<McpServersApi | null>(null);

export function McpServersApiProvider({
  api,
  children,
}: {
  api: McpServersApi;
  children: ReactNode;
}) {
  return createElement(McpServersApiContext.Provider, { value: api }, children);
}

export function useMcpServersApi(): McpServersApi {
  return useContext(McpServersApiContext) ?? defaultMcpServersApi;
}

async function listMcpServers(): Promise<McpServersList> {
  const res = await fetch(ENDPOINT, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load (${res.status})`);
  return (await res.json()) as McpServersList;
}

async function createMcpServer(args: CreateMcpServerArgs): Promise<McpServer> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = (await res.json().catch((error: unknown) => {
    throw new Error("MCP create returned invalid JSON.", { cause: error });
  })) as {
    ok?: boolean;
    error?: string;
    server?: McpServer;
  };
  if (!res.ok || !body.ok) {
    throw new Error(body.error || `Create failed (${res.status})`);
  }
  return body.server!;
}

async function deleteMcpServer(args: {
  id: string;
  scope: McpServerScope;
}): Promise<void> {
  const res = await fetch(
    `${ENDPOINT}/${encodeURIComponent(args.id)}?scope=${args.scope}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  const body = (await res.json().catch((error: unknown) => {
    throw new Error("MCP delete returned invalid JSON.", { cause: error });
  })) as {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || !body.ok) {
    throw new Error(body.error || `Delete failed (${res.status})`);
  }
}

async function reconnectMcpServer(args: ReconnectMcpServerArgs): Promise<void> {
  const res = await fetch(reconnectMcpServerUrl(args), {
    method: "POST",
    credentials: "include",
  });
  const body = await readMcpMutationBody(res);
  const error =
    typeof body?.error === "string" && body.error.trim()
      ? body.error.trim()
      : undefined;
  if (!res.ok || body?.ok !== true) {
    throw new Error(error || `Reconnect failed (${res.status})`);
  }
}

async function testExistingMcpServer(args: {
  id: string;
  scope: McpServerScope;
}): Promise<TestMcpUrlResult> {
  const res = await fetch(
    agentNativePath(
      `/_agent-native/mcp/servers/${encodeURIComponent(args.id)}/test?scope=${args.scope}`,
    ),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  const body = (await res.json().catch((error: unknown) => {
    throw new Error("MCP test returned invalid JSON.", { cause: error });
  })) as TestMcpUrlResult;
  return res.ok ? body : { ok: false, error: body.error };
}

const defaultMcpServersApi: McpServersApi = {
  list: listMcpServers,
  create: createMcpServer,
  delete: deleteMcpServer,
  reconnect: reconnectMcpServer,
  test: testMcpServerUrl,
  testExisting: testExistingMcpServer,
};

export interface UseMcpServersOptions {
  defer?: boolean;
}

export type McpServersQuery = ReturnType<typeof useMcpServers>;

/**
 * True until a list read has settled (success or error). Deferred call sites
 * must treat this as pending: hold empty states, permission derivation, and
 * connect affordances until it clears instead of reading the undefined data
 * as "no servers".
 */
export function isMcpServersPending(query: McpServersQuery): boolean {
  return !query.isSuccess && !query.isError;
}

export function useMcpServers(options: UseMcpServersOptions = {}) {
  const api = useMcpServersApi();
  const defer = options.defer === true;
  const afterPaint = useAfterPaint();
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const revalidate = () => {
      if (!hasPendingMcpConnection()) return;
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisibility);
    const removeCompleteListener = addMcpConnectionCompleteListener(revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisibility);
      removeCompleteListener();
    };
  }, [qc]);
  return useQuery<McpServersList>({
    queryKey: LIST_KEY,
    queryFn: api.list,
    staleTime: 10_000,
    enabled: defer ? afterPaint : true,
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
  const api = useMcpServersApi();
  return useMutation({
    mutationFn: api.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export interface ReconnectMcpServerArgs {
  id: string;
  scope: McpServerScope;
}

export function useDeleteMcpServer() {
  const qc = useQueryClient();
  const api = useMcpServersApi();
  return useMutation({
    mutationFn: api.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

async function readMcpMutationBody(res: Response): Promise<{
  ok?: unknown;
  error?: unknown;
} | null> {
  const text = (await res.text()).trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as { ok?: unknown; error?: unknown };
  } catch (cause) {
    throw new Error(
      `Reconnect response was not valid JSON (HTTP ${res.status}).`,
      { cause },
    );
  }
}

function reconnectMcpServerUrl(args: ReconnectMcpServerArgs): string {
  return `${ENDPOINT}/${encodeURIComponent(args.id)}/reconnect?scope=${args.scope}`;
}

export function useReconnectMcpServer() {
  const qc = useQueryClient();
  const api = useMcpServersApi();
  return useMutation({
    mutationFn: api.reconnect,
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
  if (!trimmed) return "Enter the Streamable HTTP agent integration URL.";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "Enter a full URL, including https://.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Agent integration URLs must start with https://.";
  }
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    return "Use https:// for remote agent integrations. Plain http:// is only allowed for localhost.";
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
  if (!text) return "Could not connect to that agent integration.";
  if (
    /<!doctype|<html[\s>]|<\/html>|unexpected token '<'|is not valid json/i.test(
      text,
    )
  ) {
    return "That URL returned a web page instead of an MCP response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.";
  }
  if (
    /streamable http/i.test(text) &&
    /error|failed|non-200|status/i.test(text)
  ) {
    return "The server did not complete the Streamable HTTP MCP handshake. Check the URL and any required authorization headers.";
  }
  if (
    /failed to fetch|fetch failed|networkerror|econnrefused|enotfound|timed out/i.test(
      text,
    )
  ) {
    return "Could not reach that agent integration. Check the URL and make sure it is publicly reachable from this app.";
  }
  if (/401|403|unauthorized|forbidden/i.test(text)) {
    return "The agent integration rejected the request. Add or update the required Authorization header.";
  }
  if (/404|not found|405|method not allowed/i.test(text)) {
    return "That URL is reachable, but it does not look like the MCP endpoint. Check the server's Streamable HTTP path.";
  }
  return text.length > 240 ? `${text.slice(0, 237).trimEnd()}...` : text;
}

export function formatMcpServersLoadError(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error ?? "");
  const text = raw.trim();
  if (!text) return "Could not load agent integrations.";
  if (/401|unauthorized|signed-in workspace app|workspace app/i.test(text)) {
    return "Sign in to a workspace app, then retry loading agent integrations.";
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

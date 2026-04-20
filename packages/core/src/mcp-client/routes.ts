/**
 * HTTP routes for user- and org-scope remote MCP server management.
 *
 * Mounted under `/_agent-native/mcp/servers` by `agent-chat-plugin` —
 * requires a reference to the running `McpClientManager` so mutations can
 * hot-reload the configured server set.
 *
 *   GET    /_agent-native/mcp/servers           list user + org servers
 *   POST   /_agent-native/mcp/servers           add a server
 *   DELETE /_agent-native/mcp/servers/:id       remove a server (scope via ?scope=)
 *   POST   /_agent-native/mcp/servers/:id/test  dry-run connect (no persist)
 *   POST   /_agent-native/mcp/servers/test      dry-run a URL before persisting
 */

import {
  defineEventHandler,
  getMethod,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getH3App } from "../server/framework-request-handler.js";
import { readBody } from "../server/h3-helpers.js";
import { getOrgContext } from "../org/context.js";
import { getSession } from "../server/auth.js";
import { getAllSettings } from "../settings/store.js";
import type { McpClientManager } from "./manager.js";
import type { McpConfig, McpServerConfig } from "./config.js";
import { loadMcpConfig, autoDetectMcpConfig } from "./config.js";
import {
  addRemoteServer,
  listRemoteServers,
  mergedConfigKey,
  removeRemoteServer,
  toHttpServerConfig,
  validateRemoteUrl,
  type RemoteMcpScope,
  type StoredRemoteMcpServer,
} from "./remote-store.js";

/** Redact obvious auth header values before sending to the client. */
function redactHeaders(
  headers?: Record<string, string>,
): Record<string, { set: true }> | undefined {
  if (!headers) return undefined;
  const out: Record<string, { set: true }> = {};
  for (const k of Object.keys(headers)) out[k] = { set: true };
  return out;
}

function projectForClient(
  stored: StoredRemoteMcpServer,
  scope: RemoteMcpScope,
  ownerId: string,
  status: ServerStatus,
): ClientServer {
  return {
    id: stored.id,
    scope,
    name: stored.name,
    url: stored.url,
    headers: redactHeaders(stored.headers),
    description: stored.description,
    createdAt: stored.createdAt,
    mergedId: mergedConfigKey(scope, stored, ownerId),
    status,
  };
}

export interface ClientServer {
  id: string;
  scope: RemoteMcpScope;
  name: string;
  url: string;
  headers?: Record<string, { set: true }>;
  description?: string;
  createdAt: number;
  /** The key under which this server is registered in the running MCP manager. */
  mergedId: string;
  status: ServerStatus;
}

type ServerStatus =
  | { state: "connected"; toolCount: number }
  | { state: "error"; error: string }
  | { state: "unknown" };

function statusFor(manager: McpClientManager, mergedId: string): ServerStatus {
  const snap = manager.getStatus();
  if (snap.connectedServers.includes(mergedId)) {
    const toolCount = snap.tools.filter((t) => t.source === mergedId).length;
    return { state: "connected", toolCount };
  }
  if (snap.errors[mergedId]) {
    return { state: "error", error: snap.errors[mergedId] };
  }
  if (snap.configuredServers.includes(mergedId)) {
    return { state: "unknown" };
  }
  return { state: "unknown" };
}

/**
 * Build the merged MCP config the manager should run with: file/env config
 * plus **every** user-scope and org-scope remote server persisted in the
 * settings store. Scanning all scopes means a mutation from one user's
 * session never drops another user's servers from the running manager.
 *
 * Each persisted server's merged key includes its owner discriminator
 * (`user_<emailhash>_<name>` or `org_<orgId>_<name>`) so two users' servers
 * with the same name coexist; the request-time gate in
 * `isMcpToolAllowedForRequest` then scopes tool visibility back down to the
 * calling user.
 */
export async function buildMergedConfig(): Promise<McpConfig | null> {
  const base = loadMcpConfig() ?? autoDetectMcpConfig();
  const servers: Record<string, McpServerConfig> = { ...(base?.servers ?? {}) };

  const all = await getAllSettings().catch(() => ({}));
  for (const [fullKey, value] of Object.entries(all)) {
    const userMatch = /^u:([^:]+):mcp-servers-remote$/.exec(fullKey);
    const orgMatch = /^o:([^:]+):mcp-servers-remote$/.exec(fullKey);
    let scope: RemoteMcpScope | null = null;
    let ownerId: string | null = null;
    if (userMatch) {
      scope = "user";
      ownerId = userMatch[1];
    } else if (orgMatch) {
      scope = "org";
      ownerId = orgMatch[1];
    }
    if (!scope || !ownerId) continue;
    const list = (value as { servers?: StoredRemoteMcpServer[] }).servers;
    if (!Array.isArray(list)) continue;
    for (const stored of list) {
      if (!stored || typeof stored.url !== "string" || !stored.name) continue;
      servers[mergedConfigKey(scope, stored, ownerId)] =
        toHttpServerConfig(stored);
    }
  }

  if (Object.keys(servers).length === 0) return null;
  return { servers, source: base?.source ?? "merged" };
}

async function resolveContextForRequest(event: H3Event): Promise<{
  email: string | null;
  orgId: string | null;
  role: string | null;
}> {
  let email: string | null = null;
  try {
    const session = await getSession(event);
    email = session?.email ?? null;
  } catch {
    email = null;
  }
  let orgId: string | null = null;
  let role: string | null = null;
  try {
    const ctx = await getOrgContext(event);
    orgId = ctx.orgId;
    role = ctx.role;
    if (!email) email = ctx.email;
  } catch {
    // ignore — no org context
  }
  // In solo/dev mode `getSession` can return nothing but getOrgContext still
  // yields the fallback email. Keep that as the user-scope id so single-user
  // desktop installs work without a login flow.
  if (!email) email = "local@localhost";
  return { email, orgId, role };
}

async function reconfigureManager(manager: McpClientManager): Promise<void> {
  const merged = await buildMergedConfig();
  await manager.reconfigure(merged);
}

export function mountMcpServersRoutes(
  nitroApp: any,
  manager: McpClientManager,
): void {
  if ((globalThis as any).__agentNativeMcpServersMounted) return;
  (globalThis as any).__agentNativeMcpServersMounted = true;

  try {
    getH3App(nitroApp).use(
      "/_agent-native/mcp/servers",
      defineEventHandler(async (event: H3Event) => {
        const method = getMethod(event);
        const pathname = (event.url?.pathname || "")
          .replace(/^\/+/, "")
          .replace(/\/+$/, "");
        const parts = pathname ? pathname.split("/") : [];

        setResponseHeader(event, "Content-Type", "application/json");

        // POST /servers/test — dry-run a URL+headers before persisting
        if (method === "POST" && parts.length === 1 && parts[0] === "test") {
          return handleTestUrl(event);
        }

        // Collection root
        if (parts.length === 0) {
          if (method === "GET") return handleList(event, manager);
          if (method === "POST") return handleAdd(event, manager);
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        // /:id  /  /:id/test
        if (parts.length === 1 || parts.length === 2) {
          const id = parts[0];
          if (parts.length === 2 && parts[1] === "test" && method === "POST") {
            return handleTestExisting(event, manager, id);
          }
          if (parts.length === 1 && method === "DELETE") {
            return handleDelete(event, manager, id);
          }
        }

        setResponseStatus(event, 404);
        return { error: "Not found" };
      }),
    );
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to mount /_agent-native/mcp/servers: ${err?.message ?? err}`,
    );
  }
}

async function handleList(
  event: H3Event,
  manager: McpClientManager,
): Promise<{
  user: ClientServer[];
  org: ClientServer[];
  orgId: string | null;
  role: string | null;
}> {
  const { email, orgId, role } = await resolveContextForRequest(event);
  const userServers = email ? await listRemoteServers("user", email) : [];
  const orgServers = orgId ? await listRemoteServers("org", orgId) : [];
  return {
    user: userServers.map((s) =>
      projectForClient(
        s,
        "user",
        email ?? "",
        statusFor(manager, mergedConfigKey("user", s, email ?? "")),
      ),
    ),
    org: orgServers.map((s) =>
      projectForClient(
        s,
        "org",
        orgId ?? "",
        statusFor(manager, mergedConfigKey("org", s, orgId ?? "")),
      ),
    ),
    orgId,
    role,
  };
}

async function handleAdd(event: H3Event, manager: McpClientManager) {
  const body = (await readBody(event).catch(() => ({}))) as {
    scope?: unknown;
    name?: unknown;
    url?: unknown;
    headers?: unknown;
    description?: unknown;
  };
  const scope =
    body.scope === "org" ? "org" : body.scope === "user" ? "user" : null;
  if (!scope) {
    setResponseStatus(event, 400);
    return { error: 'scope must be "user" or "org"' };
  }
  const name = typeof body.name === "string" ? body.name : "";
  const url = typeof body.url === "string" ? body.url : "";
  if (!name.trim() || !url.trim()) {
    setResponseStatus(event, 400);
    return { error: "name and url are required" };
  }
  const headers = normalizeHeaders(body.headers);
  const description =
    typeof body.description === "string" ? body.description : undefined;

  const { email, orgId, role } = await resolveContextForRequest(event);

  let scopeId: string | null = null;
  if (scope === "user") {
    scopeId = email;
  } else {
    if (!orgId) {
      setResponseStatus(event, 400);
      return {
        error: "You must belong to an organization to add an org-scope server",
      };
    }
    if (role !== "owner" && role !== "admin") {
      setResponseStatus(event, 403);
      return { error: "Only owners and admins can add org-scope MCP servers" };
    }
    scopeId = orgId;
  }
  if (!scopeId) {
    setResponseStatus(event, 401);
    return { error: "Authentication required" };
  }

  const result = await addRemoteServer(scope, scopeId, {
    name,
    url,
    headers,
    description,
  });
  if (result.ok !== true) {
    setResponseStatus(event, 400);
    return { error: result.error };
  }

  await reconfigureManager(manager);
  const mergedId = mergedConfigKey(scope, result.server, scopeId);
  return {
    ok: true,
    server: projectForClient(
      result.server,
      scope,
      scopeId,
      statusFor(manager, mergedId),
    ),
  };
}

async function handleDelete(
  event: H3Event,
  manager: McpClientManager,
  id: string,
) {
  const scope = getQuery(event).scope;
  const parsedScope =
    scope === "org" ? "org" : scope === "user" ? "user" : null;
  if (!parsedScope) {
    setResponseStatus(event, 400);
    return { error: 'scope query param must be "user" or "org"' };
  }
  const { email, orgId, role } = await resolveContextForRequest(event);

  let scopeId: string | null = null;
  if (parsedScope === "user") {
    scopeId = email;
  } else {
    if (!orgId) {
      setResponseStatus(event, 400);
      return { error: "No active organization" };
    }
    if (role !== "owner" && role !== "admin") {
      setResponseStatus(event, 403);
      return {
        error: "Only owners and admins can remove org-scope MCP servers",
      };
    }
    scopeId = orgId;
  }
  if (!scopeId) {
    setResponseStatus(event, 401);
    return { error: "Authentication required" };
  }

  const removed = await removeRemoteServer(parsedScope, scopeId, id);
  if (!removed) {
    setResponseStatus(event, 404);
    return { error: "Server not found" };
  }
  await reconfigureManager(manager);
  return { ok: true };
}

async function handleTestUrl(event: H3Event) {
  const body = (await readBody(event).catch(() => ({}))) as {
    url?: unknown;
    headers?: unknown;
  };
  const url = typeof body.url === "string" ? body.url : "";
  const check = validateRemoteUrl(url);
  if (!check.ok) {
    setResponseStatus(event, 400);
    return { ok: false, error: check.error };
  }
  const headers = normalizeHeaders(body.headers);
  const result = await tryConnect(check.url!.toString(), headers);
  if (result.ok !== true) {
    setResponseStatus(event, 400);
    return { ok: false, error: result.error };
  }
  return { ok: true, toolCount: result.toolCount, tools: result.tools };
}

async function handleTestExisting(
  event: H3Event,
  manager: McpClientManager,
  id: string,
) {
  const scope = getQuery(event).scope;
  const parsedScope =
    scope === "org" ? "org" : scope === "user" ? "user" : null;
  if (!parsedScope) {
    setResponseStatus(event, 400);
    return { error: 'scope query param must be "user" or "org"' };
  }
  const { email, orgId } = await resolveContextForRequest(event);
  const scopeId = parsedScope === "user" ? email : orgId;
  if (!scopeId) {
    setResponseStatus(event, 401);
    return { error: "Authentication required" };
  }
  const list = await listRemoteServers(parsedScope, scopeId);
  const server = list.find((s) => s.id === id);
  if (!server) {
    setResponseStatus(event, 404);
    return { error: "Server not found" };
  }
  const result = await tryConnect(server.url, server.headers);
  if (result.ok !== true) {
    setResponseStatus(event, 400);
    return { ok: false, error: result.error };
  }
  return { ok: true, toolCount: result.toolCount, tools: result.tools };
}

async function tryConnect(
  url: string,
  headers?: Record<string, string>,
): Promise<
  | { ok: true; toolCount: number; tools: string[] }
  | { ok: false; error: string }
> {
  try {
    const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    ]);
    const requestInit: Record<string, unknown> = {};
    if (headers && Object.keys(headers).length > 0) {
      requestInit.headers = headers;
    }
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit,
    });
    const client = new Client(
      { name: "agent-native-mcp-client-test", version: "1.0.0" },
      { capabilities: {} },
    );
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = ((listed?.tools ?? []) as Array<{ name: string }>).map(
        (t) => t.name,
      );
      return { ok: true, toolCount: names.length, tools: names };
    } finally {
      try {
        await client.close();
      } catch {}
      try {
        await transport.close();
      } catch {}
    }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

function normalizeHeaders(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof k !== "string" || !k.trim()) continue;
    if (typeof v !== "string") continue;
    out[k.trim()] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

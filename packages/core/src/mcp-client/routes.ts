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
 *   GET    /_agent-native/mcp/builtin           list built-in capability toggles
 *   POST   /_agent-native/mcp/builtin           update built-in capability toggles
 *   POST   /_agent-native/mcp/apps/call-tool    mediated same-server app tool call
 *   POST   /_agent-native/mcp/apps/list-tools   list tools visible to an app iframe
 *   POST   /_agent-native/mcp/apps/read-resource read a ui:// app resource
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
import { runWithRequestContext } from "../server/request-context.js";
import { getAllSettings } from "../settings/store.js";
import {
  buildMcpToolName,
  parseMcpToolName,
  type McpClientManager,
  type McpTool,
} from "./manager.js";
import type { McpConfig, McpServerConfig } from "./config.js";
import { loadMcpConfig, autoDetectMcpConfig } from "./config.js";
import { formatMcpConnectError } from "./errors.js";
import {
  areBuiltinMcpCapabilitiesSupported,
  BUILTIN_MCP_CAPABILITIES,
  getBuiltinMcpCapability,
  isBuiltinMcpCapabilityAvailable,
  listSupportedBuiltinMcpCapabilities,
  normalizeBuiltinMcpCapabilityIds,
  toBuiltinMcpServerConfig,
  type BuiltinMcpCapability,
  type BuiltinMcpCapabilityId,
} from "./builtin-capabilities.js";
import {
  builtinMcpCapabilitiesSettingsKey,
  listEnabledBuiltinMcpCapabilities,
  setBuiltinMcpCapabilityEnabled,
  setEnabledBuiltinMcpCapabilities,
} from "./builtin-store.js";
import {
  addRemoteServer,
  listRemoteServers,
  mergedConfigKey,
  removeRemoteServer,
  toHttpServerConfigAsync,
  validateRemoteUrl,
  type RemoteMcpScope,
  type StoredRemoteMcpServer,
} from "./remote-store.js";
import { fetchHubServers } from "./hub-client.js";
import { loadWorkspaceMcpServers } from "./workspace-servers.js";
import { isMcpToolAllowedForRequest } from "./visibility.js";
import { isToolVisibilityModelOnly } from "@modelcontextprotocol/ext-apps/app-bridge";

export { formatMcpConnectError } from "./errors.js";

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

export interface ClientBuiltinCapability {
  id: BuiltinMcpCapabilityId;
  serverId: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  exclusiveGroup?: string;
  available: boolean;
  unavailableReason?: string;
  notes?: string;
  enabled: { user: boolean; org: boolean };
  mergedIds: { user?: string; org?: string };
  status: { user?: ServerStatus; org?: ServerStatus };
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

function pseudoStoredBuiltin(
  capability: BuiltinMcpCapability,
): StoredRemoteMcpServer {
  return {
    id: `builtin_${capability.id}`,
    name: capability.serverId,
    url: `builtin:${capability.id}`,
    description: capability.description,
    createdAt: 0,
  };
}

export function builtinMergedConfigKey(
  scope: RemoteMcpScope,
  capability: BuiltinMcpCapability,
  ownerId: string,
): string {
  return mergedConfigKey(scope, pseudoStoredBuiltin(capability), ownerId);
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
      // Async resolve: decrypts `headerSecretKey` from app_secrets so the
      // running MCP client gets the cleartext bearer at request time.
      // Stored row contains only the secret-key reference, never the value.
      servers[mergedConfigKey(scope, stored, ownerId)] =
        await toHttpServerConfigAsync(scope, ownerId, stored);
    }
  }
  if (areBuiltinMcpCapabilitiesSupported()) {
    for (const [fullKey, value] of Object.entries(all)) {
      const settingsKey = builtinMcpCapabilitiesSettingsKey();
      const userMatch = new RegExp(`^u:([^:]+):${settingsKey}$`).exec(fullKey);
      const orgMatch = new RegExp(`^o:([^:]+):${settingsKey}$`).exec(fullKey);
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
      const enabledIds = normalizeBuiltinMcpCapabilityIds(
        Array.isArray((value as any).enabledIds)
          ? (value as any).enabledIds.map(String)
          : [],
      );
      for (const id of enabledIds) {
        const capability = getBuiltinMcpCapability(id);
        if (!capability || !isBuiltinMcpCapabilityAvailable(capability)) {
          continue;
        }
        servers[builtinMergedConfigKey(scope, capability, ownerId)] =
          toBuiltinMcpServerConfig(capability);
      }
    }
  }

  try {
    const workspaceServers = await loadWorkspaceMcpServers();
    for (const [mergedKey, cfg] of Object.entries(workspaceServers)) {
      servers[mergedKey] = cfg;
    }
  } catch (err: any) {
    console.warn(
      `[mcp-client] workspace MCP resource merge failed: ${err?.message ?? err}. Continuing with local config.`,
    );
  }

  // Hub-consume: if this app is configured to consume from a remote hub
  // (AGENT_NATIVE_MCP_HUB_URL + AGENT_NATIVE_MCP_HUB_TOKEN), pull its
  // org-scope servers and merge. Hub entries use `hub_<orgId>_<name>` so
  // they never collide with local `org_<orgId>_<name>` rows.
  try {
    const hubServers = await fetchHubServers();
    for (const [mergedKey, cfg] of Object.entries(hubServers)) {
      servers[mergedKey] = cfg;
    }
  } catch (err: any) {
    console.warn(
      `[mcp-client] hub merge failed: ${err?.message ?? err}. Continuing with local config.`,
    );
  }

  if (Object.keys(servers).length === 0) return null;
  return { servers, source: base?.source ?? "merged" };
}

function sortedConfigSignature(config: McpConfig | null): string {
  const entries = Object.entries(config?.servers ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return JSON.stringify(entries);
}

function mcpConfigRefreshIntervalMs(): number {
  const raw = process.env.AGENT_NATIVE_MCP_CONFIG_REFRESH_MS;
  if (raw?.trim() === "0") return 0;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 5_000) return parsed;
  return 60_000;
}

export function startMcpConfigRefresh(
  manager: McpClientManager,
): (() => void) | null {
  const intervalMs = mcpConfigRefreshIntervalMs();
  if (intervalMs <= 0 || typeof setInterval !== "function") return null;

  let currentSignature = sortedConfigSignature(manager.getConfig());
  let refreshing = false;
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const next = await buildMergedConfig();
      const nextSignature = sortedConfigSignature(next);
      if (nextSignature !== currentSignature) {
        await manager.reconfigure(next);
        currentSignature = nextSignature;
      }
    } catch (err: any) {
      console.warn(
        `[mcp-client] config refresh failed: ${err?.message ?? err}`,
      );
    } finally {
      refreshing = false;
    }
  };

  const timer = setInterval(refresh, intervalMs);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
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
  // No silent `local@localhost` fallback — if `getSession` returns nothing in
  // production (misconfigured deploy, expired token), the caller must reject
  // rather than silently pool every unauthenticated request under one identity.
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
  const mountedApps: WeakSet<object> = ((
    globalThis as any
  ).__agentNativeMcpServersMountedApps ??= new WeakSet<object>());
  if (mountedApps.has(nitroApp)) return;
  mountedApps.add(nitroApp);

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
    getH3App(nitroApp).use(
      "/_agent-native/mcp/builtin",
      defineEventHandler(async (event: H3Event) => {
        const method = getMethod(event);
        const pathname = (event.url?.pathname || "")
          .replace(/^\/+/, "")
          .replace(/\/+$/, "");
        const parts = pathname ? pathname.split("/") : [];

        setResponseHeader(event, "Content-Type", "application/json");
        if (parts.length === 0) {
          if (method === "GET") return handleBuiltinList(event, manager);
          if (method === "POST") return handleBuiltinUpdate(event, manager);
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        setResponseStatus(event, 404);
        return { error: "Not found" };
      }),
    );
    getH3App(nitroApp).use(
      "/_agent-native/mcp/apps",
      defineEventHandler(async (event: H3Event) => {
        const method = getMethod(event);
        const pathname = (event.url?.pathname || "")
          .replace(/^\/+/, "")
          .replace(/\/+$/, "");
        const parts = pathname ? pathname.split("/") : [];

        setResponseHeader(event, "Content-Type", "application/json");
        if (method !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }

        if (parts.length === 1 && parts[0] === "call-tool") {
          return handleMcpAppCallTool(event, manager);
        }
        if (parts.length === 1 && parts[0] === "list-tools") {
          return handleMcpAppListTools(event, manager);
        }
        if (parts.length === 1 && parts[0] === "read-resource") {
          return handleMcpAppReadResource(event, manager);
        }

        setResponseStatus(event, 404);
        return { error: "Not found" };
      }),
    );
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to mount MCP routes: ${err?.message ?? err}`,
    );
  }
}

async function withMcpAppRequestContext<T>(
  event: H3Event,
  fn: () => Promise<T>,
): Promise<T | { error: string }> {
  const { email, orgId } = await resolveContextForRequest(event);
  if (!email) {
    setResponseStatus(event, 401);
    return { error: "Authentication required" };
  }
  return runWithRequestContext(
    {
      userEmail: email ?? undefined,
      orgId: orgId ?? undefined,
    },
    fn,
  ) as Promise<T>;
}

function serverHasVisibleTools(
  manager: McpClientManager,
  serverId: string,
): boolean {
  return manager
    .getToolsForServer(serverId)
    .some(
      (tool) =>
        isMcpToolAllowedForRequest(tool.name) && isVisibleToMcpApp(tool),
    );
}

function normalizeSameServerToolName(
  serverId: string,
  rawName: unknown,
): string | null {
  if (typeof rawName !== "string" || !rawName.trim()) return null;
  const name = rawName.trim();
  const parsed = parseMcpToolName(name);
  if (!parsed) return name;
  if (parsed.serverId !== serverId) return null;
  return parsed.toolName;
}

function isVisibleToMcpApp(tool: McpTool): boolean {
  try {
    return !isToolVisibilityModelOnly(tool.raw as any);
  } catch {
    return true;
  }
}

function mcpToolForClient(tool: McpTool) {
  return {
    name: tool.originalName,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    ...(tool._meta ? { _meta: tool._meta } : {}),
  };
}

function mcpAppCallableTool(
  manager: McpClientManager,
  serverId: string,
  originalToolName: string,
): McpTool | null {
  const prefixedName = buildMcpToolName(serverId, originalToolName);
  const tool =
    manager
      .getToolsForServer(serverId)
      .find(
        (candidate) =>
          candidate.name === prefixedName ||
          candidate.originalName === originalToolName,
      ) ?? null;
  if (!tool) return null;
  if (!isMcpToolAllowedForRequest(tool.name) || !isVisibleToMcpApp(tool)) {
    return null;
  }
  return tool;
}

async function handleMcpAppCallTool(event: H3Event, manager: McpClientManager) {
  const body = (await readBody(event).catch(() => ({}))) as {
    serverId?: unknown;
    toolName?: unknown;
    arguments?: unknown;
  };
  const serverId = typeof body.serverId === "string" ? body.serverId : "";
  const originalToolName = normalizeSameServerToolName(serverId, body.toolName);
  if (!serverId || !originalToolName) {
    setResponseStatus(event, 400);
    return { error: "serverId and same-server toolName are required" };
  }

  return withMcpAppRequestContext(event, async () => {
    const tool = mcpAppCallableTool(manager, serverId, originalToolName);
    if (!tool) {
      setResponseStatus(event, 403);
      return { error: "MCP tool is not available in this request scope" };
    }
    try {
      return await manager.callTool(
        tool.name,
        body.arguments && typeof body.arguments === "object"
          ? (body.arguments as Record<string, unknown>)
          : {},
      );
    } catch (err: any) {
      setResponseStatus(event, 400);
      return { error: err?.message ?? "MCP tool call failed" };
    }
  });
}

async function handleMcpAppListTools(
  event: H3Event,
  manager: McpClientManager,
) {
  const body = (await readBody(event).catch(() => ({}))) as {
    serverId?: unknown;
  };
  const serverId = typeof body.serverId === "string" ? body.serverId : "";
  if (!serverId) {
    setResponseStatus(event, 400);
    return { error: "serverId is required" };
  }
  return withMcpAppRequestContext(event, async () => {
    if (
      !manager.hasServer(serverId) ||
      !serverHasVisibleTools(manager, serverId)
    ) {
      setResponseStatus(event, 403);
      return { error: "MCP server is not available in this request scope" };
    }
    return {
      tools: manager
        .getToolsForServer(serverId)
        .filter((tool) => isMcpToolAllowedForRequest(tool.name))
        .filter(isVisibleToMcpApp)
        .map(mcpToolForClient),
    };
  });
}

async function handleMcpAppReadResource(
  event: H3Event,
  manager: McpClientManager,
) {
  const body = (await readBody(event).catch(() => ({}))) as {
    serverId?: unknown;
    uri?: unknown;
  };
  const serverId = typeof body.serverId === "string" ? body.serverId : "";
  const uri = typeof body.uri === "string" ? body.uri : "";
  if (!serverId || !uri.startsWith("ui://")) {
    setResponseStatus(event, 400);
    return { error: "serverId and ui:// uri are required" };
  }
  return withMcpAppRequestContext(event, async () => {
    if (
      !manager.hasServer(serverId) ||
      !serverHasVisibleTools(manager, serverId)
    ) {
      setResponseStatus(event, 403);
      return { error: "MCP server is not available in this request scope" };
    }
    try {
      return await manager.readResource(serverId, uri);
    } catch (err: any) {
      setResponseStatus(event, 400);
      return { error: err?.message ?? "MCP resource read failed" };
    }
  });
}

async function handleBuiltinList(
  event: H3Event,
  manager: McpClientManager,
): Promise<{
  capabilities: ClientBuiltinCapability[];
  user: { enabledIds: BuiltinMcpCapabilityId[] };
  org: {
    enabledIds: BuiltinMcpCapabilityId[];
    orgId: string | null;
    role: string | null;
  };
}> {
  const { email, orgId, role } = await resolveContextForRequest(event);
  const supported = areBuiltinMcpCapabilitiesSupported();
  const userEnabled =
    supported && email
      ? await listEnabledBuiltinMcpCapabilities("user", email)
      : [];
  const orgEnabled =
    supported && orgId
      ? await listEnabledBuiltinMcpCapabilities("org", orgId)
      : [];

  return {
    capabilities: (supported ? BUILTIN_MCP_CAPABILITIES : []).map(
      (capability) => {
        const available = isBuiltinMcpCapabilityAvailable(capability);
        const userMergedId = email
          ? builtinMergedConfigKey("user", capability, email)
          : undefined;
        const orgMergedId = orgId
          ? builtinMergedConfigKey("org", capability, orgId)
          : undefined;
        return {
          id: capability.id,
          serverId: capability.serverId,
          name: capability.name,
          description: capability.description,
          command: capability.command,
          args: capability.args,
          exclusiveGroup: capability.exclusiveGroup,
          available,
          unavailableReason: available
            ? undefined
            : `Only available on ${capability.platforms?.join(", ")}`,
          notes: capability.notes,
          enabled: {
            user: userEnabled.includes(capability.id),
            org: orgEnabled.includes(capability.id),
          },
          mergedIds: {
            user: userMergedId,
            org: orgMergedId,
          },
          status: {
            user:
              userMergedId && userEnabled.includes(capability.id)
                ? statusFor(manager, userMergedId)
                : undefined,
            org:
              orgMergedId && orgEnabled.includes(capability.id)
                ? statusFor(manager, orgMergedId)
                : undefined,
          },
        };
      },
    ),
    user: { enabledIds: userEnabled },
    org: { enabledIds: orgEnabled, orgId, role },
  };
}

async function handleBuiltinUpdate(event: H3Event, manager: McpClientManager) {
  if (!areBuiltinMcpCapabilitiesSupported()) {
    setResponseStatus(event, 400);
    return {
      error:
        "Built-in local MCP capabilities are only available in local development.",
    };
  }

  const body = (await readBody(event).catch(() => ({}))) as {
    scope?: unknown;
    enabledIds?: unknown;
    id?: unknown;
    enabled?: unknown;
  };
  const scope =
    body.scope === "org" ? "org" : body.scope === "user" ? "user" : null;
  if (!scope) {
    setResponseStatus(event, 400);
    return { error: 'scope must be "user" or "org"' };
  }

  const { email, orgId, role } = await resolveContextForRequest(event);
  let scopeId: string | null = null;
  if (scope === "user") {
    scopeId = email;
  } else {
    if (!orgId) {
      setResponseStatus(event, 400);
      return {
        error:
          "You must belong to an organization to change org-scope built-ins",
      };
    }
    if (role !== "owner" && role !== "admin") {
      setResponseStatus(event, 403);
      return {
        error: "Only owners and admins can change org-scope MCP built-ins",
      };
    }
    scopeId = orgId;
  }
  if (!scopeId) {
    setResponseStatus(event, 401);
    return { error: "Authentication required" };
  }

  if (Array.isArray(body.enabledIds)) {
    for (const rawId of body.enabledIds) {
      const error = validateBuiltinCapabilityForEnable(String(rawId));
      if (error) {
        setResponseStatus(event, 400);
        return { error };
      }
    }
    await setEnabledBuiltinMcpCapabilities(
      scope,
      scopeId,
      body.enabledIds.map(String),
    );
  } else if (typeof body.id === "string" && typeof body.enabled === "boolean") {
    if (body.enabled) {
      const error = validateBuiltinCapabilityForEnable(body.id);
      if (error) {
        setResponseStatus(event, 400);
        return { error };
      }
    } else if (!getBuiltinMcpCapability(body.id)) {
      setResponseStatus(event, 400);
      return { error: `Unknown built-in MCP capability "${body.id}"` };
    }
    const result = await setBuiltinMcpCapabilityEnabled(
      scope,
      scopeId,
      body.id,
      body.enabled,
    );
    if (!result) {
      setResponseStatus(event, 400);
      return { error: `Unknown built-in MCP capability "${body.id}"` };
    }
  } else {
    setResponseStatus(event, 400);
    return { error: "Provide enabledIds or id + enabled" };
  }

  await reconfigureManager(manager);
  return handleBuiltinList(event, manager);
}

function validateBuiltinCapabilityForEnable(id: string): string | null {
  const capability = getBuiltinMcpCapability(id);
  if (!capability) return `Unknown built-in MCP capability "${id}"`;
  if (!listSupportedBuiltinMcpCapabilities().includes(capability)) {
    if (!areBuiltinMcpCapabilitiesSupported()) {
      return "Built-in local MCP capabilities are only available in local development.";
    }
    return `${capability.name} is only available on ${capability.platforms?.join(", ")}`;
  }
  return null;
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
  const { email, orgId } = await resolveContextForRequest(event);
  if (!email && !orgId) {
    setResponseStatus(event, 401);
    return { error: "Authentication required" };
  }

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
  // `server.headers` holds only the cleartext (non-secret) subset; auth headers
  // (Authorization, API keys) live encrypted in app_secrets and are resolved by
  // toHttpServerConfigAsync. Testing with cleartext-only headers would fail for
  // any server that uses encrypted credentials.
  const config = await toHttpServerConfigAsync(parsedScope, scopeId, server);
  const result = await tryConnect(server.url, config.headers);
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
    return { ok: false, error: formatMcpConnectError(err) };
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

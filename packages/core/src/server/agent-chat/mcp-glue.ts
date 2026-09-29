import {
  defineEventHandler,
  getMethod,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import {
  buildMergedConfig,
  getHubStatus,
  McpClientManager,
  McpConfigUnreadableError,
} from "../../mcp-client/index.js";
import {
  normalizeMcpPrincipal,
  principalFromRequestContext,
  resolveMcpPrincipalForEvent,
  type McpPrincipal,
} from "../../mcp-client/principal.js";
import { getH3App } from "../framework-request-handler.js";

const MCP_MANAGER_CACHE_LIMIT = 32;
const MCP_MANAGER_IDLE_TTL_MS = 15 * 60_000;
const MCP_CONFIG_TTL_MS = 60_000;

interface McpManagerEntry {
  manager: McpClientManager;
  principal: McpPrincipal;
  lastAccessedAt: number;
  configuredAt: number;
  ready: Promise<void> | null;
}

const managers = new Map<string, McpManagerEntry>();

function principalKey(principal: McpPrincipal): string {
  return JSON.stringify([principal.userEmail, principal.orgId]);
}

async function stopEntry(entry: McpManagerEntry): Promise<void> {
  try {
    await entry.manager.stop();
  } catch (error) {
    console.warn("[mcp-client] manager cleanup failed:", error);
  }
}

function evictExpiredManagers(now: number): void {
  for (const [key, entry] of managers) {
    if (entry.ready || now - entry.lastAccessedAt <= MCP_MANAGER_IDLE_TTL_MS)
      continue;
    managers.delete(key);
    void stopEntry(entry);
  }
}

function evictLeastRecentlyUsedManager(): boolean {
  const oldest = [...managers.entries()]
    .sort(([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt)
    .find(([, entry]) => !entry.ready);
  if (!oldest) return false;
  managers.delete(oldest[0]);
  void stopEntry(oldest[1]);
  return true;
}

async function hydrateEntry(entry: McpManagerEntry): Promise<void> {
  const config = await buildMergedConfig(entry.principal);
  await entry.manager.reconfigure(config);
  entry.configuredAt = Date.now();
}

/** Lazily hydrate one bounded manager for one authenticated user/org pair. */
export async function getMcpManagerForPrincipal(
  rawPrincipal: McpPrincipal,
  forceRefresh = false,
): Promise<McpClientManager> {
  const principal = normalizeMcpPrincipal(rawPrincipal);
  if (!principal) throw new Error("Authenticated MCP principal required");
  const now = Date.now();
  evictExpiredManagers(now);
  const key = principalKey(principal);
  let entry = managers.get(key);
  if (!entry) {
    while (managers.size >= MCP_MANAGER_CACHE_LIMIT) {
      if (!evictLeastRecentlyUsedManager()) {
        throw new Error("MCP manager capacity is busy hydrating");
      }
    }
    entry = {
      manager: new McpClientManager(null),
      principal,
      lastAccessedAt: now,
      configuredAt: 0,
      ready: null,
    };
    managers.set(key, entry);
  }
  entry.lastAccessedAt = now;

  if (forceRefresh || now - entry.configuredAt >= MCP_CONFIG_TTL_MS) {
    if (!entry.ready) {
      entry.ready = hydrateEntry(entry).catch(async (error) => {
        if (managers.get(key) === entry) managers.delete(key);
        await stopEntry(entry!);
        throw error;
      });
    }
    try {
      await entry.ready;
    } finally {
      entry.ready = null;
    }
  } else if (entry.ready) {
    await entry.ready;
  }

  if (entry.configuredAt === 0) {
    throw new McpConfigUnreadableError(
      new Error("MCP manager did not finish configuration"),
    );
  }
  return entry.manager;
}

export async function getMcpManagerForCurrentRequest(
  forceRefresh = false,
): Promise<McpClientManager> {
  const principal = principalFromRequestContext();
  if (!principal) throw new Error("Authenticated MCP principal required");
  return getMcpManagerForPrincipal(principal, forceRefresh);
}

export async function invalidateMcpManagersForScope(
  scope: "user" | "org",
  scopeId: string,
  keep?: McpClientManager,
): Promise<void> {
  const stale: McpManagerEntry[] = [];
  for (const [key, entry] of managers) {
    const matches =
      scope === "user"
        ? entry.principal.userEmail === scopeId
        : entry.principal.orgId === scopeId;
    if (!matches || entry.manager === keep) continue;
    managers.delete(key);
    stale.push(entry);
  }
  await Promise.all(stale.map(stopEntry));
}

export async function stopAllMcpManagers(): Promise<void> {
  const entries = [...managers.values()];
  managers.clear();
  await Promise.all(entries.map(stopEntry));
}

export function _resetMcpManagerRegistryForTests(): Promise<void> {
  return stopAllMcpManagers();
}

export function resolveBackgroundMcpToolSelection(
  requested: readonly string[],
  includeAll: boolean,
): readonly string[] | null | undefined {
  if (includeAll) return undefined;
  return requested.length > 0 ? requested : null;
}

export function mountMcpHubStatusRoute(nitroApp: any): void {
  const mountedApps: WeakSet<object> = ((
    globalThis as any
  ).__agentNativeMcpHubStatusMountedApps ??= new WeakSet<object>());
  if (mountedApps.has(nitroApp)) return;
  mountedApps.add(nitroApp);
  try {
    getH3App(nitroApp).use(
      "/_agent-native/mcp/hub/status",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        setResponseHeader(event, "Cache-Control", "private, no-store");
        const principal = await resolveMcpPrincipalForEvent(event);
        if (!principal) {
          setResponseStatus(event, 401);
          return { error: "Authentication required" };
        }
        setResponseHeader(event, "Content-Type", "application/json");
        const status = getHubStatus();
        return { ...status, hubUrl: principal.orgId ? status.hubUrl : null };
      }),
    );
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to mount /_agent-native/mcp/hub/status: ${err?.message ?? err}`,
    );
  }
}

export function mountMcpStatusRoute(nitroApp: any): void {
  const mountedApps: WeakSet<object> = ((
    globalThis as any
  ).__agentNativeMcpStatusMountedApps ??= new WeakSet<object>());
  if (mountedApps.has(nitroApp)) return;
  mountedApps.add(nitroApp);
  try {
    getH3App(nitroApp).use(
      "/_agent-native/mcp/status",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        setResponseHeader(event, "Cache-Control", "private, no-store");
        const principal = await resolveMcpPrincipalForEvent(event);
        if (!principal) {
          setResponseStatus(event, 401);
          return { error: "Authentication required" };
        }
        setResponseHeader(event, "Content-Type", "application/json");
        const manager = await getMcpManagerForPrincipal(principal);
        return manager.getStatus();
      }),
    );
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to mount /_agent-native/mcp/status: ${err?.message ?? err}`,
    );
  }
}

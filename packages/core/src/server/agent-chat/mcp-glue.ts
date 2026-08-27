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
import { getH3App } from "../framework-request-handler.js";

// ---------------------------------------------------------------------------
// MCP client glue — a shared manager reference + a /_agent-native/mcp/status
// route so onboarding / settings UIs can see which MCP servers are live.
// ---------------------------------------------------------------------------

let _globalMcpManager: McpClientManager | null = null;
let _globalMcpManagerReady: (() => Promise<void>) | null = null;
let _globalMcpRefreshQueue: Promise<void> = Promise.resolve();

export function setGlobalMcpManager(
  manager: McpClientManager | null,
  ready?: (() => Promise<void>) | null,
): void {
  _globalMcpManager = manager;
  _globalMcpManagerReady = manager ? (ready ?? null) : null;
  _globalMcpRefreshQueue = Promise.resolve();
}

/** Internal: access the current process's MCP client manager, if any. */
export function getGlobalMcpManager(): McpClientManager | null {
  return _globalMcpManager;
}

/** Wait for lazy serverless MCP hydration before an app-visible call. */
export async function waitForGlobalMcpManager(): Promise<McpClientManager | null> {
  const manager = getGlobalMcpManager();
  if (manager) await _globalMcpManagerReady?.();
  return getGlobalMcpManager();
}

/** Internal: reload the process's MCP client manager after persisted settings change. */
export async function refreshGlobalMcpManager(): Promise<boolean> {
  const refresh = _globalMcpRefreshQueue.then(async () => {
    const manager = getGlobalMcpManager();
    if (!manager) return false;
    try {
      await _globalMcpManagerReady?.();
      const currentManager = getGlobalMcpManager();
      if (!currentManager) return false;
      await currentManager.reconfigure(await buildMergedConfig());
      return true;
    } catch (err) {
      if (err instanceof McpConfigUnreadableError) {
        console.warn(`[mcp-client] global refresh skipped: ${err.message}`);
        return false;
      }
      throw err;
    }
  });
  _globalMcpRefreshQueue = refresh.then(
    () => undefined,
    () => undefined,
  );
  return refresh;
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
        setResponseHeader(event, "Content-Type", "application/json");
        return getHubStatus();
      }),
    );
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to mount /_agent-native/mcp/hub/status: ${err?.message ?? err}`,
    );
  }
}

export function mountMcpStatusRoute(
  nitroApp: any,
  manager: McpClientManager,
): void {
  // Idempotent per Nitro app; dev-all may host multiple templates in one process.
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
        setResponseHeader(event, "Content-Type", "application/json");
        return manager.getStatus();
      }),
    );
  } catch (err: any) {
    console.warn(
      `[mcp-client] Failed to mount /_agent-native/mcp/status: ${err?.message ?? err}`,
    );
  }
}

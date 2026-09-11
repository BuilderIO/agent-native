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
let _globalMcpManagerGeneration = 0;
let _resolveGlobalMcpManagerChange: (() => void) | null = null;
let _globalMcpManagerChange = new Promise<void>((resolve) => {
  _resolveGlobalMcpManagerChange = resolve;
});
let _globalMcpRefreshQueue: Promise<void> = Promise.resolve();

export function setGlobalMcpManager(
  manager: McpClientManager | null,
  ready?: (() => Promise<void>) | null,
): void {
  _globalMcpManagerGeneration += 1;
  _resolveGlobalMcpManagerChange?.();
  _globalMcpManagerChange = new Promise<void>((resolve) => {
    _resolveGlobalMcpManagerChange = resolve;
  });
  _globalMcpManager = manager;
  _globalMcpManagerReady = manager ? (ready ?? null) : null;
}

/** Internal: access the current process's MCP client manager, if any. */
export function getGlobalMcpManager(): McpClientManager | null {
  return _globalMcpManager;
}

/** Wait for lazy serverless MCP hydration before an app-visible call. */
export async function waitForGlobalMcpManager(): Promise<McpClientManager | null> {
  while (true) {
    const manager = getGlobalMcpManager();
    if (!manager) return null;
    const generation = _globalMcpManagerGeneration;
    const ready = _globalMcpManagerReady;
    const change = _globalMcpManagerChange;
    if (ready) await Promise.race([ready(), change]);
    if (
      generation === _globalMcpManagerGeneration &&
      manager === _globalMcpManager &&
      ready === _globalMcpManagerReady
    ) {
      return manager;
    }
  }
}

/** Internal: reload the process's MCP client manager after persisted settings change. */
export async function refreshGlobalMcpManager(): Promise<boolean> {
  const refresh = _globalMcpRefreshQueue.then(async () => {
    const manager = getGlobalMcpManager();
    if (!manager) return false;
    const generation = _globalMcpManagerGeneration;
    const ready = _globalMcpManagerReady;
    const change = _globalMcpManagerChange;
    try {
      if (ready) await Promise.race([ready(), change]);
      if (
        generation !== _globalMcpManagerGeneration ||
        manager !== _globalMcpManager ||
        ready !== _globalMcpManagerReady
      ) {
        return false;
      }
      const config = await buildMergedConfig();
      if (
        generation !== _globalMcpManagerGeneration ||
        manager !== _globalMcpManager ||
        ready !== _globalMcpManagerReady
      ) {
        return false;
      }
      await manager.reconfigure(config);
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

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
} from "../../mcp-client/index.js";
import { getH3App } from "../framework-request-handler.js";

// ---------------------------------------------------------------------------
// MCP client glue — a shared manager reference + a /_agent-native/mcp/status
// route so onboarding / settings UIs can see which MCP servers are live.
// ---------------------------------------------------------------------------

let _globalMcpManager: McpClientManager | null = null;

export function setGlobalMcpManager(manager: McpClientManager): void {
  _globalMcpManager = manager;
}

/** Internal: access the current process's MCP client manager, if any. */
export function getGlobalMcpManager(): McpClientManager | null {
  return _globalMcpManager;
}

/** Internal: reload the process's MCP client manager after persisted settings change. */
export async function refreshGlobalMcpManager(): Promise<boolean> {
  const manager = getGlobalMcpManager();
  if (!manager) return false;
  await manager.reconfigure(await buildMergedConfig());
  return true;
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

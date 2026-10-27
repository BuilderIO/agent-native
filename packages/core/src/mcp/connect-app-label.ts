import { getAppConfig } from "../app-config/index.js";
import { isAgentNativeDeploymentEnvironment } from "../config.js";
import { resolveDeployEnvironment } from "../server/deploy-environment.js";
import type { McpConnectEnvironment } from "../shared/mcp-connect-content.js";

export function connectEnvironment(): McpConnectEnvironment {
  const environment = resolveDeployEnvironment();
  if (!isAgentNativeDeploymentEnvironment(environment)) {
    throw new Error(`Unknown deployment environment "${environment}"`);
  }
  return environment;
}

/**
 * The app a connection belongs to. The connect identity names its MCP server
 * from this and the `agent_connected` event reports it, so the two cannot
 * disagree about which app a client connected to.
 */
export function connectAppLabel(
  origin: string,
  options: { appId?: string; appName?: string },
  environment: McpConnectEnvironment,
): string {
  const app = getAppConfig().app;
  const declared = options.appId ?? app.id ?? app.template ?? app.slug;
  if (declared) return declared;
  // Deployed functions run without npm's `npm_package_name`, so first-party
  // apps usually land here. A beta lane is `beta.<app>.agent-native.com`: its
  // leading label names the lane, and every beta app would share it. Only a
  // beta deployment drops it, so no production name changes.
  try {
    const host = new URL(origin).hostname;
    const h = environment === "beta" ? host.replace(/^beta\./, "") : host;
    return h.split(".")[0] || h;
  } catch {
    return options.appName || "app";
  }
}

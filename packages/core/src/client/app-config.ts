import type { AgentNativeConfig } from "../config.js";

declare const __AGENT_NATIVE_APP_CONFIG__: AgentNativeConfig | undefined;
declare const __AGENT_NATIVE_APP_ID__: string | undefined;
declare const __AGENT_NATIVE_WORKSPACE_APP_ID__: string | undefined;

export function injectedAgentNativeConfig(): AgentNativeConfig {
  return typeof __AGENT_NATIVE_APP_CONFIG__ === "undefined"
    ? {}
    : __AGENT_NATIVE_APP_CONFIG__;
}

export function injectedAgentNativeAppId(): string | null {
  const browserConfig =
    typeof window !== "undefined"
      ? (
          window as Window & {
            __AGENT_NATIVE_CONFIG__?: {
              appId?: unknown;
              workspaceAppId?: unknown;
            };
          }
        ).__AGENT_NATIVE_CONFIG__
      : undefined;
  const workspaceAppId =
    typeof __AGENT_NATIVE_WORKSPACE_APP_ID__ === "string" &&
    __AGENT_NATIVE_WORKSPACE_APP_ID__.trim()
      ? __AGENT_NATIVE_WORKSPACE_APP_ID__
      : browserConfig?.workspaceAppId;
  const appId = browserConfig?.appId;
  const compiledAppId =
    typeof __AGENT_NATIVE_APP_ID__ === "string"
      ? __AGENT_NATIVE_APP_ID__
      : undefined;

  for (const value of [workspaceAppId, appId, compiledAppId]) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().toLowerCase();
    }
  }
  return null;
}

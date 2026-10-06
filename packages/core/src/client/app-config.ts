import type { AgentNativeConfig } from "../config.js";

declare const __AGENT_NATIVE_APP_CONFIG__: AgentNativeConfig | undefined;
declare const __AGENT_NATIVE_APP_ID__: string | undefined;

export function injectedAgentNativeConfig(): AgentNativeConfig {
  return typeof __AGENT_NATIVE_APP_CONFIG__ === "undefined"
    ? {}
    : __AGENT_NATIVE_APP_CONFIG__;
}

export function injectedAgentNativeAppId(): string | null {
  if (typeof __AGENT_NATIVE_APP_ID__ !== "string") return null;
  return __AGENT_NATIVE_APP_ID__.trim().toLowerCase() || null;
}

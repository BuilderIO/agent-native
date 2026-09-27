import type { AgentNativeConfig } from "../config.js";

declare const __AGENT_NATIVE_APP_CONFIG__: AgentNativeConfig | undefined;

export function injectedAgentNativeConfig(): AgentNativeConfig {
  return typeof __AGENT_NATIVE_APP_CONFIG__ === "undefined"
    ? {}
    : __AGENT_NATIVE_APP_CONFIG__;
}

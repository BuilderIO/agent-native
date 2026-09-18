import type { AgentNativeConfig } from "../config.js";

declare const __AGENT_NATIVE_APP_CONFIG__: AgentNativeConfig | undefined;

/** The resolved, public app policy injected by the Vite plugin. */
export function injectedAgentNativeConfig(): AgentNativeConfig {
  return typeof __AGENT_NATIVE_APP_CONFIG__ === "undefined"
    ? {}
    : __AGENT_NATIVE_APP_CONFIG__;
}

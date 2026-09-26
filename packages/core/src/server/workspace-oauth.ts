import { getAppConfig } from "../app-config/index.js";
import { isTruthyRuntimeValue } from "../shared/runtime-config.js";

export function isWorkspaceOAuthCallbackRelayEnabled(): boolean {
  const workspace = getAppConfig().workspace;
  const metaEnv = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env;

  return (
    workspace.isWorkspace === true ||
    typeof workspace.appsJson === "string" ||
    [
      process.env.AGENT_NATIVE_WORKSPACE,
      process.env.VITE_AGENT_NATIVE_WORKSPACE,
      metaEnv?.AGENT_NATIVE_WORKSPACE,
      metaEnv?.VITE_AGENT_NATIVE_WORKSPACE,
    ].some((value) => isTruthyRuntimeValue(value)) ||
    [
      process.env.AGENT_NATIVE_WORKSPACE_APP_ID,
      process.env.VITE_AGENT_NATIVE_WORKSPACE_APP_ID,
      metaEnv?.AGENT_NATIVE_WORKSPACE_APP_ID,
      metaEnv?.VITE_AGENT_NATIVE_WORKSPACE_APP_ID,
    ].some((value) => typeof value === "string" && value.trim().length > 0)
  );
}

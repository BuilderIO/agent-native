import { normalizeFrameworkRoutePrefix } from "../shared/framework-route-prefix.js";
import { injectedAgentNativeConfig } from "./app-config.js";

export function frameworkRoutePrefix(): string {
  const configured = injectedAgentNativeConfig().runtime?.frameworkRoutePrefix;
  if (configured !== undefined) {
    return normalizeFrameworkRoutePrefix(configured);
  }
  const projected =
    typeof window === "undefined"
      ? undefined
      : (
          window as Window & {
            __AGENT_NATIVE_CONFIG__?: { frameworkRoutePrefix?: unknown };
          }
        ).__AGENT_NATIVE_CONFIG__?.frameworkRoutePrefix;
  return normalizeFrameworkRoutePrefix(
    projected,
    "window.__AGENT_NATIVE_CONFIG__.frameworkRoutePrefix",
  );
}

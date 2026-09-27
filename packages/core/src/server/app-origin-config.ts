import { getAppConfig, resolveAppHomePath } from "../app-config/index.js";
import { safeJsonForHtml } from "../shared/agent-readable-resource.js";
import { normalizeAppBasePath } from "./app-base-path.js";

function workspaceAppMountPathsFromJson(
  value: string | undefined,
): string[] | undefined {
  if (!value?.trim()) return undefined;

  try {
    const parsed: unknown = JSON.parse(value);
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "apps" in parsed
        ? (parsed as { apps?: unknown }).apps
        : null;
    if (!Array.isArray(entries)) return undefined;

    const paths = entries
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const rawPath =
          typeof record.path === "string"
            ? record.path
            : typeof record.id === "string"
              ? `/${record.id}`
              : undefined;
        const normalized = normalizeAppBasePath(rawPath);
        return normalized || null;
      })
      .filter((path): path is string => Boolean(path));
    return paths.length ? Array.from(new Set(paths)) : undefined;
  } catch {
    // coercion-ok: malformed manifests omit optional mount hints; the browser falls back to the live segment.
    return undefined;
  }
}

export function resolvePublicAppOriginConfig(): {
  appHomePath: string;
  appUrl?: string;
  workspaceGatewayUrl?: string;
  workspaceOAuthOrigin?: string;
  workspaceRuntime?: boolean;
  workspaceAppMountPaths?: string[];
} | null {
  const config = getAppConfig();
  const workspaceRuntime =
    config.workspace.isWorkspace === true ||
    typeof config.workspace.appsJson === "string";
  const workspaceAppMountPaths = workspaceAppMountPathsFromJson(
    config.workspace.appsJson,
  );
  const resolved = {
    appHomePath: resolveAppHomePath(config.app, config.workspace),
    ...(config.app.url ? { appUrl: config.app.url } : {}),
    ...(config.workspace.gatewayUrl
      ? { workspaceGatewayUrl: config.workspace.gatewayUrl }
      : {}),
    ...(config.workspace.oauthOrigin
      ? { workspaceOAuthOrigin: config.workspace.oauthOrigin }
      : {}),
    ...(workspaceRuntime ? { workspaceRuntime: true } : {}),
    ...(workspaceAppMountPaths ? { workspaceAppMountPaths } : {}),
  };
  return Object.keys(resolved).length > 0 ? resolved : null;
}

export function getAppOriginClientConfigScript(): string | null {
  const config = resolvePublicAppOriginConfig();
  if (!config) return null;

  return [
    "<script data-agent-native-app-origin-config>",
    "window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,",
    safeJsonForHtml(config),
    ");",
    "</script>",
  ].join("");
}

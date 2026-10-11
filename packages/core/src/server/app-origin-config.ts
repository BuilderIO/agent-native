import { getAppConfig, resolveAppHomePath } from "../app-config/index.js";
import { safeJsonForHtml } from "../shared/agent-readable-resource.js";
import { normalizeAppBasePath } from "./app-base-path.js";

function workspaceAppMountConfigFromJson(
  value: string | undefined,
  workspaceAppId: string | undefined,
): { paths?: string[]; currentPath?: string } | undefined {
  if (!value?.trim()) return undefined;

  try {
    const parsed: unknown = JSON.parse(value);
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "apps" in parsed
        ? (parsed as { apps?: unknown }).apps
        : null;
    if (!Array.isArray(entries)) return undefined;

    const paths: string[] = [];
    let currentPath: string | undefined;
    const hasWorkspaceAppId =
      typeof workspaceAppId === "string" && workspaceAppId.trim().length > 0;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : undefined;
      const rawPath =
        typeof record.path === "string"
          ? record.path
          : id
            ? `/${id}`
            : undefined;
      const normalized = normalizeAppBasePath(rawPath);
      if (normalized) paths.push(normalized);
      if (
        hasWorkspaceAppId &&
        id === workspaceAppId &&
        currentPath === undefined
      ) {
        currentPath = normalized || (rawPath?.trim() ? "/" : undefined);
      }
    }
    const uniquePaths = Array.from(new Set(paths));
    return uniquePaths.length || currentPath
      ? {
          ...(uniquePaths.length ? { paths: uniquePaths } : {}),
          ...(currentPath ? { currentPath } : {}),
        }
      : undefined;
  } catch {
    // coercion-ok: malformed manifests omit optional mount hints; the app base path remains authoritative.
    return undefined;
  }
}

export function resolvePublicAppOriginConfig(): {
  appId?: string;
  workspaceAppId?: string;
  workspaceAppPath?: string;
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
  const workspaceAppMountConfig = workspaceAppMountConfigFromJson(
    config.workspace.appsJson,
    config.app.workspaceId,
  );
  const configuredWorkspaceAppPath = config.app.basePath?.trim()
    ? normalizeAppBasePath(config.app.basePath) || "/"
    : undefined;
  const workspaceAppPath =
    workspaceAppMountConfig?.currentPath ??
    (workspaceRuntime ? configuredWorkspaceAppPath : undefined);
  const resolved = {
    ...(config.app.id ? { appId: config.app.id } : {}),
    ...(config.app.workspaceId
      ? { workspaceAppId: config.app.workspaceId }
      : {}),
    ...(workspaceAppPath ? { workspaceAppPath } : {}),
    appHomePath: resolveAppHomePath(config.app, config.workspace),
    ...(config.app.url ? { appUrl: config.app.url } : {}),
    ...(config.workspace.gatewayUrl
      ? { workspaceGatewayUrl: config.workspace.gatewayUrl }
      : {}),
    ...(config.workspace.oauthOrigin
      ? { workspaceOAuthOrigin: config.workspace.oauthOrigin }
      : {}),
    ...(workspaceRuntime ? { workspaceRuntime: true } : {}),
    ...(workspaceAppMountConfig?.paths
      ? { workspaceAppMountPaths: workspaceAppMountConfig.paths }
      : {}),
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

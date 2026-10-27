import { safeJsonForHtml } from "./agent-readable-resource.js";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "./embed-auth.js";
import { EXTERNAL_EMBED_WINDOW_KEY } from "./route-chunk-recovery-bootstrap.js";

export const EMBED_TOKEN_STORAGE_KEY = "agent-native:embed-auth-token";
export const MCP_CHAT_BRIDGE_STORAGE_KEY = "agent-native:mcp-chat-bridge";

export interface WorkspaceAppMountPathOptions {
  explicitRootPath?: boolean;
  fallbackOverridesExplicitRoot?: boolean;
  fallbackPath?: string;
  frameworkRoutePrefix?: string;
  preferDeclaredMounts?: boolean;
  routerBasePath?: unknown;
  workspaceAppMountPaths?: unknown;
  workspaceAppPath?: unknown;
}

export function resolveWorkspaceAppMountPath(
  pathname: string,
  options: WorkspaceAppMountPathOptions = {},
): string | undefined {
  const normalize = (value: unknown): string => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed || trimmed === "/") return "";
    return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  };
  const matches = (basePath: string): boolean =>
    Boolean(basePath) &&
    (pathname === basePath || pathname.startsWith(`${basePath}/`));
  const configuredPath = normalize(options.workspaceAppPath);
  const explicitRootPath =
    options.explicitRootPath === true ||
    (typeof options.workspaceAppPath === "string" &&
      options.workspaceAppPath.trim().length > 0 &&
      configuredPath === "");
  const fallbackPath = normalize(options.fallbackPath);
  const routerBasePath = normalize(options.routerBasePath);

  if (routerBasePath && matches(routerBasePath)) return routerBasePath;
  if (configuredPath && matches(configuredPath)) return configuredPath;
  if (explicitRootPath && !options.preferDeclaredMounts) return "";

  const segment = pathname.split("/").find(Boolean);
  if (!segment) {
    if (explicitRootPath) return "";
    return fallbackPath || undefined;
  }
  const frameworkRoutePrefix =
    normalize(options.frameworkRoutePrefix) || "/_agent-native";
  if (
    `/${segment}` === "/_agent-native" ||
    `/${segment}` === frameworkRoutePrefix ||
    segment === "api"
  ) {
    return fallbackPath;
  }

  const matchingMount = (
    Array.isArray(options.workspaceAppMountPaths)
      ? options.workspaceAppMountPaths
      : []
  )
    .filter((value): value is string => typeof value === "string")
    .map(normalize)
    .filter((basePath) => matches(basePath))
    .sort((left, right) => right.length - left.length)[0];
  if (matchingMount) return matchingMount;
  if (fallbackPath && options.fallbackOverridesExplicitRoot)
    return fallbackPath;
  if (explicitRootPath) return "";
  return fallbackPath || undefined;
}

export function resolveExternalEmbedTargetBasePath(
  target: unknown,
  options: WorkspaceAppMountPathOptions & {
    frameworkRoutePrefix?: string;
    workspaceRuntime?: boolean;
  } = {},
): string | undefined {
  if (typeof target !== "string" || !target.startsWith("/")) return undefined;

  const url = new URL(target, "http://agent-native.invalid");
  const markers = [
    options.frameworkRoutePrefix || "/_agent-native",
    "/_agent-native",
  ];
  for (const marker of markers) {
    for (
      let index = url.pathname.indexOf(marker);
      index > 0;
      index = url.pathname.indexOf(marker, index + 1)
    ) {
      const end = index + marker.length;
      if (end === url.pathname.length || url.pathname[end] === "/") {
        const prefix = url.pathname.slice(0, index).trim();
        return prefix ? `/${prefix.replace(/^\/+|\/+$/g, "")}` : "";
      }
    }
  }
  if (!options.workspaceRuntime) return undefined;

  const segments = url.pathname.split("/").filter(Boolean);
  const segment = segments[0];
  const frameworkRoutePrefix = options.frameworkRoutePrefix || "/_agent-native";
  const fallbackPath =
    segments.length > 1 &&
    segment &&
    `/${segment}` !== "/_agent-native" &&
    `/${segment}` !== frameworkRoutePrefix &&
    segment !== "api"
      ? `/${segment}`
      : "";
  return resolveWorkspaceAppMountPath(url.pathname, {
    ...options,
    fallbackPath,
    fallbackOverridesExplicitRoot: true,
    preferDeclaredMounts: true,
  });
}

function normalizedStorageBasePath(basePath: string | undefined): string {
  const trimmed = basePath?.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function appScopedStorageKey(
  key: string,
  basePath: string | undefined,
  workspaceRuntime: boolean,
): string {
  if (!workspaceRuntime) return key;
  const normalizedBasePath = normalizedStorageBasePath(basePath);
  return `${key}:${normalizedBasePath || "/"}`;
}

export function embedTokenStorageKey(
  basePath: string | undefined,
  workspaceRuntime: boolean,
): string {
  return appScopedStorageKey(
    EMBED_TOKEN_STORAGE_KEY,
    basePath,
    workspaceRuntime,
  );
}

export function mcpChatBridgeStorageKey(
  basePath: string | undefined,
  workspaceRuntime: boolean,
): string {
  return appScopedStorageKey(
    MCP_CHAT_BRIDGE_STORAGE_KEY,
    basePath,
    workspaceRuntime,
  );
}

/**
 * Set on `<html>` for the life of a document that is an app nested in an MCP
 * App widget (a ChatGPT, Codex, or Claude card or side pane). Layout reads it
 * so the widget never shows app chrome the host already owns, and so a client
 * navigation that drops the embed query params cannot bring that chrome back.
 */
export const MCP_APP_WIDGET_EMBED_ATTRIBUTE = "data-agent-native-mcp-widget";

/**
 * Inline script that sets the attribute before the server-rendered shell
 * skeleton paints: that HTML is one public document for every visitor, so it
 * cannot know it is nested in a widget. It decides from the same inputs as
 * `isMcpAppWidgetEmbed` (child frame, chat-bridge flag in the URL or stored,
 * embed credential in the URL, stored, or `embedded=1`); `mcp-app-host.spec.ts`
 * runs both over one table so they cannot drift.
 */
export function getMcpAppWidgetEmbedBootScriptBody(
  basePath?: string,
  workspaceRuntime = false,
): string {
  const dynamicWorkspaceBasePath = workspaceRuntime && basePath === undefined;
  const tokenStorageKey = dynamicWorkspaceBasePath
    ? EMBED_TOKEN_STORAGE_KEY
    : embedTokenStorageKey(basePath ?? "", workspaceRuntime);
  const bridgeStorageKey = dynamicWorkspaceBasePath
    ? MCP_CHAT_BRIDGE_STORAGE_KEY
    : mcpChatBridgeStorageKey(basePath ?? "", workspaceRuntime);
  return `(function __anMcpWidgetBoot() {
  try {
    var w = window;
    if (w.parent === w) return;
    var tokenStorageKey = ${safeJsonForHtml(tokenStorageKey)};
    var bridgeStorageKey = ${safeJsonForHtml(bridgeStorageKey)};
    var external = w[${safeJsonForHtml(EXTERNAL_EMBED_WINDOW_KEY)}];
    ${
      dynamicWorkspaceBasePath
        ? `var appConfig = w.__AGENT_NATIVE_CONFIG__ || {};
    var runtimeConfig = appConfig.runtime && typeof appConfig.runtime === "object"
      ? appConfig.runtime
      : {};
    var resolveWorkspaceAppMountPath = ${resolveWorkspaceAppMountPath.toString()};
    var resolveExternalEmbedTargetBasePath = ${resolveExternalEmbedTargetBasePath.toString()};
    var workspaceOptions = {
      workspaceAppPath: appConfig.workspaceAppPath,
      workspaceAppMountPaths: appConfig.workspaceAppMountPaths,
      routerBasePath: w.__reactRouterContext && w.__reactRouterContext.basename,
      frameworkRoutePrefix: runtimeConfig.frameworkRoutePrefix || appConfig.frameworkRoutePrefix
    };
    var basePath = external && typeof external.target === "string"
      ? resolveExternalEmbedTargetBasePath(external.target, Object.assign({ workspaceRuntime: true }, workspaceOptions))
      : resolveWorkspaceAppMountPath(w.location.pathname, workspaceOptions);
    if (typeof basePath !== "string") return;
    var normalizedBasePath = basePath.trim();
    normalizedBasePath = !normalizedBasePath || normalizedBasePath === "/"
      ? ""
      : "/" + normalizedBasePath.replace(/^\\/+/, "").replace(/\\/+$/, "");
    tokenStorageKey += ":" + (normalizedBasePath || "/");
    bridgeStorageKey += ":" + (normalizedBasePath || "/");`
        : ""
    }
    var params = new URLSearchParams(w.location.search);
    var stored = function (key) {
      // coercion-ok: denied storage reads as absent, exactly as isEmbedMcpChatBridgeActive does.
      try { return w.sessionStorage.getItem(key); } catch (e) { return null; }
    };
    var token = params.get(${safeJsonForHtml(EMBED_TOKEN_QUERY_PARAM)}) || stored(tokenStorageKey) || (external && typeof external.token === "string" ? external.token : "");
    var mode = params.get(${safeJsonForHtml(EMBED_MODE_QUERY_PARAM)});
    var flag = params.get(${safeJsonForHtml(MCP_APP_CHAT_BRIDGE_QUERY_PARAM)});
    var externalBridgeActive = external && external.chatBridgeActive === true;
    if (!token && mode !== "1" && mode !== "true" && !externalBridgeActive) return;
    var scope = stored(bridgeStorageKey);
    if (flag === "1" || flag === "true" || externalBridgeActive || (scope && (!token || scope === token))) {
      document.documentElement.setAttribute(${safeJsonForHtml(MCP_APP_WIDGET_EMBED_ATTRIBUTE)}, "1");
    }
  // coercion-ok: the attribute is a first-paint hint; isMcpAppWidgetEmbed sets it again once the app runs.
  } catch (e) {}
})();`;
}

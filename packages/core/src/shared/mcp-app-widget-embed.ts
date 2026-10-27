import { safeJsonForHtml } from "./agent-readable-resource.js";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "./embed-auth.js";
import { EXTERNAL_EMBED_WINDOW_KEY } from "./route-chunk-recovery-bootstrap.js";

export const EMBED_TOKEN_STORAGE_KEY = "agent-native:embed-auth-token";
export const MCP_CHAT_BRIDGE_STORAGE_KEY = "agent-native:mcp-chat-bridge";

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
  basePath = "",
  workspaceRuntime = false,
): string {
  const tokenStorageKey = embedTokenStorageKey(basePath, workspaceRuntime);
  const bridgeStorageKey = mcpChatBridgeStorageKey(basePath, workspaceRuntime);
  return `(function __anMcpWidgetBoot() {
  try {
    var w = window;
    if (w.parent === w) return;
    var params = new URLSearchParams(w.location.search);
    var stored = function (key) {
      // coercion-ok: denied storage reads as absent, exactly as isEmbedMcpChatBridgeActive does.
      try { return w.sessionStorage.getItem(key); } catch (e) { return null; }
    };
    var external = w[${safeJsonForHtml(EXTERNAL_EMBED_WINDOW_KEY)}];
    var token = params.get(${safeJsonForHtml(EMBED_TOKEN_QUERY_PARAM)}) || stored(${safeJsonForHtml(tokenStorageKey)}) || (external && typeof external.token === "string" ? external.token : "");
    var mode = params.get(${safeJsonForHtml(EMBED_MODE_QUERY_PARAM)});
    var flag = params.get(${safeJsonForHtml(MCP_APP_CHAT_BRIDGE_QUERY_PARAM)});
    var externalBridgeActive = external && external.chatBridgeActive === true;
    if (!token && mode !== "1" && mode !== "true" && !externalBridgeActive) return;
    var scope = stored(${safeJsonForHtml(bridgeStorageKey)});
    if (flag === "1" || flag === "true" || externalBridgeActive || (scope && (!token || scope === token))) {
      document.documentElement.setAttribute(${safeJsonForHtml(MCP_APP_WIDGET_EMBED_ATTRIBUTE)}, "1");
    }
  // coercion-ok: the attribute is a first-paint hint; isMcpAppWidgetEmbed sets it again once the app runs.
  } catch (e) {}
})();`;
}

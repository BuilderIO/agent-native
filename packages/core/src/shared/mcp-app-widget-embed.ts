import { safeJsonForHtml } from "./agent-readable-resource.js";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "./embed-auth.js";

export const EMBED_TOKEN_STORAGE_KEY = "agent-native:embed-auth-token";
export const MCP_CHAT_BRIDGE_STORAGE_KEY = "agent-native:mcp-chat-bridge";

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
export function getMcpAppWidgetEmbedBootScriptBody(): string {
  return `(function __anMcpWidgetBoot() {
  try {
    var w = window;
    if (w.parent === w) return;
    var params = new URLSearchParams(w.location.search);
    var stored = function (key) {
      // coercion-ok: denied storage reads as absent, exactly as isEmbedMcpChatBridgeActive does.
      try { return w.sessionStorage.getItem(key); } catch (e) { return null; }
    };
    var token = params.get(${safeJsonForHtml(EMBED_TOKEN_QUERY_PARAM)}) || stored(${safeJsonForHtml(EMBED_TOKEN_STORAGE_KEY)});
    var mode = params.get(${safeJsonForHtml(EMBED_MODE_QUERY_PARAM)});
    if (!token && mode !== "1" && mode !== "true") return;
    var flag = params.get(${safeJsonForHtml(MCP_APP_CHAT_BRIDGE_QUERY_PARAM)});
    var scope = stored(${safeJsonForHtml(MCP_CHAT_BRIDGE_STORAGE_KEY)});
    if (flag === "1" || flag === "true" || (scope && (!token || scope === token))) {
      document.documentElement.setAttribute(${safeJsonForHtml(MCP_APP_WIDGET_EMBED_ATTRIBUTE)}, "1");
    }
  // coercion-ok: the attribute is a first-paint hint; isMcpAppWidgetEmbed sets it again once the app runs.
  } catch (e) {}
})();`;
}

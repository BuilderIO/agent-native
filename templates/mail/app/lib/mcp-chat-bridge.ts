const EMBED_TOKEN_QUERY_PARAM = "__an_embed_token";
const MCP_CHAT_BRIDGE_QUERY_PARAM = "__an_mcp_chat_bridge";
const EMBED_TOKEN_STORAGE_KEY = "agent-native:embed-auth-token";
const MCP_CHAT_BRIDGE_STORAGE_KEY = "agent-native:mcp-chat-bridge";

export function isMcpChatBridgeActive(): boolean {
  if (typeof window === "undefined") return false;
  let params: URLSearchParams;
  try {
    params = new URL(window.location.href).searchParams;
  } catch {
    params = new URLSearchParams(window.location.search);
  }
  const bridgeFlag = params.get(MCP_CHAT_BRIDGE_QUERY_PARAM);
  if (bridgeFlag === "1" || bridgeFlag === "true") return true;
  try {
    const token =
      params.get(EMBED_TOKEN_QUERY_PARAM) ||
      window.sessionStorage?.getItem(EMBED_TOKEN_STORAGE_KEY);
    const bridgeScope = window.sessionStorage?.getItem(
      MCP_CHAT_BRIDGE_STORAGE_KEY,
    );
    return Boolean(token && bridgeScope === token);
  } catch {
    return false;
  }
}

export const EMBED_START_PATH = "/_agent-native/embed/start";
export const EMBED_TOKEN_QUERY_PARAM = "__an_embed_token";
export const EMBED_TARGET_QUERY_PARAM = "__an_embed_target";
export const EMBED_MODE_QUERY_PARAM = "embedded";
export const MCP_APP_CHAT_BRIDGE_QUERY_PARAM = "__an_mcp_chat_bridge";
export const EMBED_SESSION_COOKIE = "an_embed_session";
export const EMBED_TARGET_HEADER = "x-agent-native-embed-target";

export const MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX =
  "capability:mcp-directory-widget-read:";

const MCP_DIRECTORY_ACTION_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

export function createMcpDirectoryWidgetReadCapability(
  actionNames: readonly string[],
): string | undefined {
  const names = [...new Set(actionNames)].sort();
  if (
    names.length === 0 ||
    names.some(
      (name) =>
        typeof name !== "string" || !MCP_DIRECTORY_ACTION_NAME.test(name),
    )
  ) {
    return undefined;
  }
  const scope = `${MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX}${names.join(",")}`;
  return scope.length <= 512 ? scope : undefined;
}

export function isMcpDirectoryWidgetReadCapabilityScope(
  scope: string | undefined,
): boolean {
  return (
    scope?.startsWith(MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX) === true
  );
}

export function allowsMcpDirectoryWidgetReadAction(
  scope: string | undefined,
  actionName: string,
): boolean {
  if (
    !isMcpDirectoryWidgetReadCapabilityScope(scope) ||
    !scope ||
    scope.length > 512
  ) {
    return false;
  }
  const names = scope
    .slice(MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX.length)
    .split(",");
  return (
    names.length > 0 &&
    new Set(names).size === names.length &&
    names.every((name) => MCP_DIRECTORY_ACTION_NAME.test(name)) &&
    names.includes(actionName)
  );
}

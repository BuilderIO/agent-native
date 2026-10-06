export const EMBED_START_PATH = "/_agent-native/embed/start";
export const EMBED_TOKEN_QUERY_PARAM = "__an_embed_token";
export const EMBED_TARGET_QUERY_PARAM = "__an_embed_target";
export const EMBED_MODE_QUERY_PARAM = "embedded";
export const MCP_APP_CHAT_BRIDGE_QUERY_PARAM = "__an_mcp_chat_bridge";
export const EMBED_SESSION_COOKIE = "an_embed_session";
export const EMBED_TARGET_HEADER = "x-agent-native-embed-target";

export const MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX =
  "capability:mcp-directory-widget-read:";
export const MCP_DIRECTORY_WIDGET_READ_CAPABILITY_MAX_LENGTH = 2048;

const MCP_DIRECTORY_ACTION_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const MCP_DIRECTORY_SCOPE_KEY = /^[A-Za-z0-9_.-]{1,128}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export interface McpDirectoryWidgetReadCapabilityInput {
  appId: string;
  resourceUri: string;
  resourceIds: Record<string, string>;
  actionArguments: Record<string, Record<string, string>>;
}

interface McpDirectoryWidgetReadCapability extends McpDirectoryWidgetReadCapabilityInput {
  version: 1;
}

function isStringRecord(
  value: unknown,
  { minEntries = 1, maxEntries = 16 } = {},
): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length >= minEntries &&
    entries.length <= maxEntries &&
    entries.every(
      ([key, item]) =>
        MCP_DIRECTORY_SCOPE_KEY.test(key) &&
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= 256 &&
        !CONTROL_CHARS.test(item),
    )
  );
}

function isWidgetReadCapability(
  value: unknown,
): value is McpDirectoryWidgetReadCapability {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const capability = value as Record<string, unknown>;
  if (
    capability.version !== 1 ||
    typeof capability.appId !== "string" ||
    !MCP_DIRECTORY_SCOPE_KEY.test(capability.appId) ||
    typeof capability.resourceUri !== "string" ||
    !capability.resourceUri.startsWith("ui://") ||
    capability.resourceUri.length > 512 ||
    CONTROL_CHARS.test(capability.resourceUri) ||
    !isStringRecord(capability.resourceIds)
  ) {
    return false;
  }

  const actionArguments = capability.actionArguments;
  if (
    !actionArguments ||
    typeof actionArguments !== "object" ||
    Array.isArray(actionArguments)
  ) {
    return false;
  }
  const actions = Object.entries(actionArguments);
  return (
    actions.length > 0 &&
    actions.length <= 32 &&
    actions.every(
      ([actionName, args]) =>
        MCP_DIRECTORY_ACTION_NAME.test(actionName) && isStringRecord(args),
    )
  );
}

type DecodedMcpDirectoryWidgetReadCapability =
  | {
      ok: true;
      capability: McpDirectoryWidgetReadCapability;
    }
  | {
      ok: false;
      reason:
        | "invalid-scope"
        | "invalid-encoding"
        | "invalid-json"
        | "invalid-capability";
    };

function decodeMcpDirectoryWidgetReadCapability(
  scope: string,
): DecodedMcpDirectoryWidgetReadCapability {
  if (
    !scope.startsWith(MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX) ||
    scope.length > MCP_DIRECTORY_WIDGET_READ_CAPABILITY_MAX_LENGTH
  ) {
    return { ok: false, reason: "invalid-scope" };
  }

  let json: string;
  try {
    json = decodeURIComponent(
      scope.slice(MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX.length),
    );
  } catch (error) {
    if (error instanceof URIError) {
      return { ok: false, reason: "invalid-encoding" };
    }
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, reason: "invalid-json" };
    }
    throw error;
  }

  return isWidgetReadCapability(value)
    ? { ok: true, capability: value }
    : { ok: false, reason: "invalid-capability" };
}

function sortStringRecord(value: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function createMcpDirectoryWidgetReadCapability(
  input: McpDirectoryWidgetReadCapabilityInput,
): string | undefined {
  if (
    !input ||
    typeof input.appId !== "string" ||
    !MCP_DIRECTORY_SCOPE_KEY.test(input.appId) ||
    typeof input.resourceUri !== "string" ||
    !input.resourceUri.startsWith("ui://") ||
    input.resourceUri.length > 512 ||
    CONTROL_CHARS.test(input.resourceUri) ||
    !isStringRecord(input.resourceIds)
  ) {
    return undefined;
  }

  const actionEntries = Object.entries(input.actionArguments ?? {});
  if (
    actionEntries.length === 0 ||
    actionEntries.length > 32 ||
    actionEntries.some(
      ([actionName, args]) =>
        !MCP_DIRECTORY_ACTION_NAME.test(actionName) || !isStringRecord(args),
    )
  ) {
    return undefined;
  }

  const capability: McpDirectoryWidgetReadCapability = {
    version: 1,
    appId: input.appId,
    resourceUri: input.resourceUri,
    resourceIds: sortStringRecord(input.resourceIds),
    actionArguments: Object.fromEntries(
      actionEntries
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([actionName, args]) => [actionName, sortStringRecord(args)]),
    ),
  };
  const scope =
    MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX +
    encodeURIComponent(JSON.stringify(capability));
  return scope.length <= MCP_DIRECTORY_WIDGET_READ_CAPABILITY_MAX_LENGTH
    ? scope
    : undefined;
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
  input: {
    actionName: string;
    appId: string | undefined;
    resourceUri: string | undefined;
    args?: Record<string, unknown>;
    allowedArgumentNames?: readonly string[];
    requireArgumentMatch?: boolean;
  },
): boolean {
  if (!scope || !input.appId || !input.resourceUri) return false;
  const decoded = decodeMcpDirectoryWidgetReadCapability(scope);
  if (!decoded.ok) return false;
  const capability = decoded.capability;
  if (
    !capability ||
    capability.appId !== input.appId ||
    capability.resourceUri !== input.resourceUri
  ) {
    return false;
  }
  const expectedArgs = capability.actionArguments[input.actionName];
  if (!expectedArgs) return false;

  const allowedNames = [...(input.allowedArgumentNames ?? [])].sort();
  const expectedNames = Object.keys(expectedArgs).sort();
  if (
    allowedNames.length !== expectedNames.length ||
    allowedNames.some((name, index) => name !== expectedNames[index])
  ) {
    return false;
  }
  if (input.requireArgumentMatch === false) return true;

  const suppliedArgs = Object.entries(input.args ?? {});
  return (
    suppliedArgs.length > 0 &&
    suppliedArgs.every(
      ([name, value]) =>
        Object.hasOwn(expectedArgs, name) && expectedArgs[name] === value,
    )
  );
}

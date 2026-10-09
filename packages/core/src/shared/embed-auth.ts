export const EMBED_START_PATH = "/_agent-native/embed/start";
export const EMBED_TOKEN_QUERY_PARAM = "__an_embed_token";
export const EMBED_TARGET_QUERY_PARAM = "__an_embed_target";
export const EMBED_MODE_QUERY_PARAM = "embedded";
export const MCP_APP_CHAT_BRIDGE_QUERY_PARAM = "__an_mcp_chat_bridge";
export const MCP_DIRECTORY_WIDGET_QUERY_PARAM = "__an_mcp_directory_widget";
export const EMBED_SESSION_COOKIE = "an_embed_session";
export const EMBED_TARGET_HEADER = "x-agent-native-embed-target";
export const MCP_DIRECTORY_WIDGET_SESSION_EXPIRED_HEADER =
  "x-agent-native-widget-session-expired";

export const MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX =
  "capability:mcp-directory-widget-read:";
export const MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_PREFIX =
  "capability:mcp-directory-widget-write:";
export const MCP_DIRECTORY_WIDGET_READ_CAPABILITY_MAX_LENGTH = 2048;
// The scope is signed into the embed token (about 1.3x its length plus the
// session claims), and that token is also the embed session cookie, which a
// browser drops above 4096 bytes. A realistic Slides grant signs to about 3.1 KB;
// only the widest identities exceed a cookie, and setEmbedSessionCookie then
// leaves the page on its query/bearer token. embed-session.spec.ts measures both.
export const MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH = 4096;
export const MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_AGE_MS = 15 * 60 * 1000;
const MCP_DIRECTORY_WIDGET_INTEGER_ARGUMENT_MAX = 5_000;

const MCP_DIRECTORY_ACTION_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const MCP_DIRECTORY_SCOPE_KEY = /^[A-Za-z0-9_.-]{1,128}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export interface McpDirectoryWidgetReadCapabilityInput {
  appId: string;
  resourceUri: string;
  resourceIds: Record<string, string>;
  actionArguments: Record<
    string,
    Record<string, McpDirectoryWidgetReadArgument>
  >;
}

export interface McpDirectoryWidgetWriteCapabilityInput {
  appId: string;
  resourceUri: string;
  resourceIds: Record<string, string>;
  userEmail: string;
  orgId?: string;
  expiresAtMs: number;
  readActionArguments: Record<
    string,
    Record<string, McpDirectoryWidgetReadArgument>
  >;
  writeActionArguments: Record<
    string,
    Record<string, McpDirectoryWidgetReadArgument>
  >;
}

export type McpDirectoryWidgetReadArgument =
  | string
  | { type: "integerRange"; min: number; max: number }
  /** Dynamic input validated against the server action schema after resource binding. */
  | { type: "actionSchema" }
  /** Dynamic input whose artifact relationship is checked by the action. */
  | { type: "actionSchemaResourceBound"; resourceKey: string };

interface McpDirectoryWidgetReadCapability extends McpDirectoryWidgetReadCapabilityInput {
  version: 1;
}

interface McpDirectoryWidgetWriteCapability extends McpDirectoryWidgetWriteCapabilityInput {
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

function isWidgetReadArgument(
  value: unknown,
  allowResourceBound = false,
): value is McpDirectoryWidgetReadArgument {
  if (typeof value === "string") {
    return (
      value.length > 0 && value.length <= 256 && !CONTROL_CHARS.test(value)
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const range = value as Record<string, unknown>;
  if (range.type === "actionSchema") {
    return Object.keys(range).length === 1;
  }
  if (range.type === "actionSchemaResourceBound") {
    return (
      allowResourceBound &&
      Object.keys(range).length === 2 &&
      typeof range.resourceKey === "string" &&
      MCP_DIRECTORY_SCOPE_KEY.test(range.resourceKey)
    );
  }
  return (
    range.type === "integerRange" &&
    Object.keys(range).length === 3 &&
    Number.isSafeInteger(range.min) &&
    Number.isSafeInteger(range.max) &&
    (range.min as number) >= 0 &&
    (range.max as number) >= (range.min as number) &&
    (range.max as number) <= MCP_DIRECTORY_WIDGET_INTEGER_ARGUMENT_MAX
  );
}

function isWidgetReadArgumentRecord(
  value: unknown,
  {
    minEntries = 1,
    maxEntries = 16,
    allowResourceBound = false,
  }: {
    minEntries?: number;
    maxEntries?: number;
    allowResourceBound?: boolean;
  } = {},
): value is Record<string, McpDirectoryWidgetReadArgument> {
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
        isWidgetReadArgument(item, allowResourceBound),
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
        MCP_DIRECTORY_ACTION_NAME.test(actionName) &&
        isWidgetReadArgumentRecord(args, { minEntries: 0 }),
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

function decodeMcpDirectoryWidgetWriteCapability(
  scope: string,
): McpDirectoryWidgetWriteCapability | undefined {
  if (
    !scope.startsWith(MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_PREFIX) ||
    scope.length > MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH
  ) {
    return undefined;
  }
  try {
    const value = JSON.parse(
      decodeURIComponent(
        scope.slice(MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_PREFIX.length),
      ),
    ) as Record<string, unknown>;
    if (
      value.version !== 1 ||
      typeof value.appId !== "string" ||
      !MCP_DIRECTORY_SCOPE_KEY.test(value.appId) ||
      typeof value.resourceUri !== "string" ||
      !value.resourceUri.startsWith("ui://") ||
      value.resourceUri.length > 512 ||
      CONTROL_CHARS.test(value.resourceUri) ||
      !isStringRecord(value.resourceIds) ||
      typeof value.userEmail !== "string" ||
      value.userEmail.length > 320 ||
      CONTROL_CHARS.test(value.userEmail) ||
      (value.orgId !== undefined &&
        (typeof value.orgId !== "string" ||
          value.orgId.length > 256 ||
          CONTROL_CHARS.test(value.orgId))) ||
      !Number.isSafeInteger(value.expiresAtMs)
    ) {
      return undefined;
    }
    const readActionArguments = value.readActionArguments;
    const writeActionArguments = value.writeActionArguments;
    if (
      !isWidgetActionArgumentMap(readActionArguments, { minActions: 0 }) ||
      !isWidgetActionArgumentMap(writeActionArguments, {
        maxArguments: 32,
        allowResourceBound: true,
      }) ||
      Object.keys(writeActionArguments).some((actionName) => {
        const args = writeActionArguments[actionName];
        return !Object.values(args).some((argument) =>
          typeof argument === "string"
            ? Object.values(
                value.resourceIds as Record<string, string>,
              ).includes(argument)
            : argument.type === "actionSchemaResourceBound" &&
              Object.hasOwn(
                value.resourceIds as Record<string, string>,
                argument.resourceKey,
              ),
        );
      })
    ) {
      return undefined;
    }
    return value as unknown as McpDirectoryWidgetWriteCapability;
  } catch {
    // coercion-ok: malformed caller scope remains an absent, denied capability.
    return undefined;
  }
}

function isWidgetActionArgumentMap(
  value: unknown,
  {
    minActions = 1,
    maxArguments = 16,
    allowResourceBound = false,
  }: {
    minActions?: number;
    maxArguments?: number;
    allowResourceBound?: boolean;
  } = {},
): value is Record<string, Record<string, McpDirectoryWidgetReadArgument>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actions = Object.entries(value);
  return (
    actions.length >= minActions &&
    actions.length <= 32 &&
    actions.every(
      ([actionName, args]) =>
        MCP_DIRECTORY_ACTION_NAME.test(actionName) &&
        isWidgetReadArgumentRecord(args, {
          minEntries: 0,
          maxEntries: maxArguments,
          allowResourceBound,
        }),
    )
  );
}

function sortStringRecord(value: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function sortWidgetReadArgumentRecord(
  value: Record<string, McpDirectoryWidgetReadArgument>,
) {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, argument]) => [
        key,
        typeof argument === "string" ? argument : { ...argument },
      ]),
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
        !MCP_DIRECTORY_ACTION_NAME.test(actionName) ||
        !isWidgetReadArgumentRecord(args, { minEntries: 0 }),
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
        .map(([actionName, args]) => [
          actionName,
          sortWidgetReadArgumentRecord(args),
        ]),
    ),
  };
  const scope =
    MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX +
    encodeURIComponent(JSON.stringify(capability));
  return scope.length <= MCP_DIRECTORY_WIDGET_READ_CAPABILITY_MAX_LENGTH
    ? scope
    : undefined;
}

export function createMcpDirectoryWidgetWriteCapability(
  input: McpDirectoryWidgetWriteCapabilityInput,
): string | undefined {
  const now = Date.now();
  if (
    !input ||
    typeof input.appId !== "string" ||
    !MCP_DIRECTORY_SCOPE_KEY.test(input.appId) ||
    typeof input.resourceUri !== "string" ||
    !input.resourceUri.startsWith("ui://") ||
    input.resourceUri.length > 512 ||
    CONTROL_CHARS.test(input.resourceUri) ||
    !isStringRecord(input.resourceIds) ||
    typeof input.userEmail !== "string" ||
    !input.userEmail.trim() ||
    input.userEmail.length > 320 ||
    CONTROL_CHARS.test(input.userEmail) ||
    (input.orgId !== undefined &&
      (typeof input.orgId !== "string" ||
        !input.orgId.trim() ||
        input.orgId.length > 256 ||
        CONTROL_CHARS.test(input.orgId))) ||
    !Number.isSafeInteger(input.expiresAtMs) ||
    input.expiresAtMs <= now ||
    input.expiresAtMs >
      now + MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_AGE_MS ||
    !isWidgetActionArgumentMap(input.readActionArguments, { minActions: 0 }) ||
    !isWidgetActionArgumentMap(input.writeActionArguments, {
      maxArguments: 32,
      allowResourceBound: true,
    }) ||
    Object.values(input.writeActionArguments).some(
      (args) =>
        !Object.values(args).some((argument) =>
          typeof argument === "string"
            ? Object.values(input.resourceIds).includes(argument)
            : argument.type === "actionSchemaResourceBound" &&
              Object.hasOwn(input.resourceIds, argument.resourceKey),
        ),
    )
  ) {
    return undefined;
  }

  const capability: McpDirectoryWidgetWriteCapability = {
    version: 1,
    appId: input.appId,
    resourceUri: input.resourceUri,
    resourceIds: sortStringRecord(input.resourceIds),
    userEmail: input.userEmail.trim().toLowerCase(),
    ...(input.orgId ? { orgId: input.orgId } : {}),
    expiresAtMs: input.expiresAtMs,
    readActionArguments: Object.fromEntries(
      Object.entries(input.readActionArguments)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([actionName, args]) => [
          actionName,
          sortWidgetReadArgumentRecord(args),
        ]),
    ),
    writeActionArguments: Object.fromEntries(
      Object.entries(input.writeActionArguments)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([actionName, args]) => [
          actionName,
          sortWidgetReadArgumentRecord(args),
        ]),
    ),
  };
  const scope =
    MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_PREFIX +
    encodeURIComponent(JSON.stringify(capability));
  return scope.length <= MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH
    ? scope
    : undefined;
}

export function renewMcpDirectoryWidgetCapabilityScope(
  scope: string | undefined,
  input: {
    appId: string;
    resourceUri: string;
    userEmail: string;
    orgId?: string | null;
    expiresAtMs: number;
    readAllowed: boolean;
    writeAllowed: boolean;
  },
): string | undefined {
  if (!scope || !input.appId || !input.userEmail || !input.readAllowed) {
    return undefined;
  }
  if (isMcpDirectoryWidgetWriteCapabilityScope(scope)) {
    const capability = decodeMcpDirectoryWidgetWriteCapability(scope);
    if (
      !capability ||
      capability.appId !== input.appId ||
      capability.userEmail !== input.userEmail.trim().toLowerCase() ||
      capability.orgId !== (input.orgId ?? undefined)
    ) {
      return undefined;
    }
    if (!input.writeAllowed) {
      return createMcpDirectoryWidgetReadCapability({
        appId: capability.appId,
        resourceUri: input.resourceUri,
        resourceIds: capability.resourceIds,
        actionArguments: capability.readActionArguments,
      });
    }
    return createMcpDirectoryWidgetWriteCapability({
      ...capability,
      resourceUri: input.resourceUri,
      expiresAtMs: input.expiresAtMs,
    });
  }

  const decoded = decodeMcpDirectoryWidgetReadCapability(scope);
  return decoded.ok && decoded.capability.appId === input.appId
    ? createMcpDirectoryWidgetReadCapability({
        ...decoded.capability,
        resourceUri: input.resourceUri,
      })
    : undefined;
}

function sameWidgetActionArguments(
  left: Record<string, Record<string, McpDirectoryWidgetReadArgument>>,
  right: Record<string, Record<string, McpDirectoryWidgetReadArgument>>,
): boolean {
  const normalize = (
    value: Record<string, Record<string, McpDirectoryWidgetReadArgument>>,
  ) =>
    Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([actionName, args]) => [
          actionName,
          Object.fromEntries(
            Object.entries(args).sort(([a], [b]) => a.localeCompare(b)),
          ),
        ]),
    );
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function canRenewMcpDirectoryWidgetCapabilityScope(
  previousScope: string,
  renewedScope: string,
  identity: { userEmail: string; orgId?: string | null },
): boolean {
  if (!identity.userEmail.trim()) return false;
  const previousWrite = isMcpDirectoryWidgetWriteCapabilityScope(previousScope);
  const renewedWrite = isMcpDirectoryWidgetWriteCapabilityScope(renewedScope);
  if (renewedWrite && !previousWrite) return false;

  const identityMatches = (capability: McpDirectoryWidgetWriteCapability) =>
    capability.userEmail === identity.userEmail.trim().toLowerCase() &&
    capability.orgId === (identity.orgId ?? undefined);

  if (previousWrite) {
    const previous = decodeMcpDirectoryWidgetWriteCapability(previousScope);
    if (!previous || !identityMatches(previous)) return false;
    if (renewedWrite) {
      const renewed = decodeMcpDirectoryWidgetWriteCapability(renewedScope);
      return Boolean(
        renewed &&
        identityMatches(renewed) &&
        renewed.appId === previous.appId &&
        sameWidgetActionArguments(
          renewed.readActionArguments,
          previous.readActionArguments,
        ) &&
        sameWidgetActionArguments(
          renewed.writeActionArguments,
          previous.writeActionArguments,
        ) &&
        JSON.stringify(renewed.resourceIds) ===
          JSON.stringify(previous.resourceIds),
      );
    }

    const renewed = decodeMcpDirectoryWidgetReadCapability(renewedScope);
    return Boolean(
      renewed.ok &&
      renewed.capability.appId === previous.appId &&
      sameWidgetActionArguments(
        renewed.capability.actionArguments,
        previous.readActionArguments,
      ) &&
      JSON.stringify(renewed.capability.resourceIds) ===
        JSON.stringify(previous.resourceIds),
    );
  }

  const previous = decodeMcpDirectoryWidgetReadCapability(previousScope);
  const renewed = decodeMcpDirectoryWidgetReadCapability(renewedScope);
  return Boolean(
    !renewedWrite &&
    previous.ok &&
    renewed.ok &&
    renewed.capability.appId === previous.capability.appId &&
    sameWidgetActionArguments(
      renewed.capability.actionArguments,
      previous.capability.actionArguments,
    ) &&
    JSON.stringify(renewed.capability.resourceIds) ===
      JSON.stringify(previous.capability.resourceIds),
  );
}

export function isMcpDirectoryWidgetReadCapabilityScope(
  scope: string | undefined,
): boolean {
  return (
    scope?.startsWith(MCP_DIRECTORY_WIDGET_READ_CAPABILITY_PREFIX) === true
  );
}

export function isMcpDirectoryWidgetWriteCapabilityScope(
  scope: string | undefined,
): boolean {
  return (
    scope?.startsWith(MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_PREFIX) === true
  );
}

export function isMcpDirectoryWidgetCapabilityScope(
  scope: string | undefined,
): boolean {
  return (
    isMcpDirectoryWidgetReadCapabilityScope(scope) ||
    isMcpDirectoryWidgetWriteCapabilityScope(scope)
  );
}

export function matchesMcpDirectoryWidgetWriteCapability(
  scope: string | undefined,
  input: {
    appId: string;
    resourceUri: string;
    userEmail: string;
    orgId?: string | null;
  },
): boolean {
  if (!scope || !isMcpDirectoryWidgetWriteCapabilityScope(scope)) {
    return false;
  }
  const capability = decodeMcpDirectoryWidgetWriteCapability(scope);
  return (
    capability !== undefined &&
    capability.expiresAtMs > Date.now() &&
    capability.appId === input.appId &&
    capability.resourceUri === input.resourceUri &&
    capability.userEmail === input.userEmail.trim().toLowerCase() &&
    capability.orgId === (input.orgId ?? undefined)
  );
}

export function isExpiredMcpDirectoryWidgetWriteCapability(
  scope: string | undefined,
  input: {
    appId: string;
    resourceUri: string;
    userEmail: string;
    orgId?: string | null;
  },
): boolean {
  if (!scope || !isMcpDirectoryWidgetWriteCapabilityScope(scope)) {
    return false;
  }
  const capability = decodeMcpDirectoryWidgetWriteCapability(scope);
  return (
    capability !== undefined &&
    capability.expiresAtMs <= Date.now() &&
    capability.appId === input.appId &&
    capability.resourceUri === input.resourceUri &&
    capability.userEmail === input.userEmail.trim().toLowerCase() &&
    capability.orgId === (input.orgId ?? undefined)
  );
}

export function getMcpDirectoryWidgetReadCapabilityResourceIds(
  scope: string | undefined,
  input: { appId: string; resourceUri: string },
): Record<string, string> | undefined {
  if (
    !matchesMcpDirectoryWidgetReadCapabilityResource(scope, input) ||
    !scope
  ) {
    return undefined;
  }
  const decoded = decodeMcpDirectoryWidgetReadCapability(scope);
  return decoded.ok ? { ...decoded.capability.resourceIds } : undefined;
}

export function getMcpDirectoryWidgetWriteCapabilityGrant(
  scope: string | undefined,
  input: {
    appId: string;
    resourceUri: string;
    userEmail: string;
    orgId?: string | null;
  },
): { resourceIds: Record<string, string>; actionNames: string[] } | undefined {
  if (!matchesMcpDirectoryWidgetWriteCapability(scope, input) || !scope) {
    return undefined;
  }
  const capability = decodeMcpDirectoryWidgetWriteCapability(scope);
  return capability
    ? {
        resourceIds: { ...capability.resourceIds },
        actionNames: Object.keys(capability.writeActionArguments),
      }
    : undefined;
}

export function getMcpDirectoryWidgetWriteCapabilityExpiresAt(
  scope: string | undefined,
): number | undefined {
  if (!scope || !isMcpDirectoryWidgetWriteCapabilityScope(scope)) {
    return undefined;
  }
  return decodeMcpDirectoryWidgetWriteCapability(scope)?.expiresAtMs;
}

export function matchesMcpDirectoryWidgetReadCapabilityResource(
  scope: string | undefined,
  input: { appId: string; resourceUri: string },
): boolean {
  if (!scope || !isMcpDirectoryWidgetReadCapabilityScope(scope)) return false;
  const decoded = decodeMcpDirectoryWidgetReadCapability(scope);
  return (
    decoded.ok &&
    decoded.capability.appId === input.appId &&
    decoded.capability.resourceUri === input.resourceUri
  );
}

function widgetReadActionArgumentsForScope(
  scope: string,
): Record<string, Record<string, McpDirectoryWidgetReadArgument>> | undefined {
  if (isMcpDirectoryWidgetWriteCapabilityScope(scope)) {
    const capability = decodeMcpDirectoryWidgetWriteCapability(scope);
    return capability && capability.expiresAtMs > Date.now()
      ? capability.readActionArguments
      : undefined;
  }
  const decoded = decodeMcpDirectoryWidgetReadCapability(scope);
  return decoded.ok ? decoded.capability.actionArguments : undefined;
}

export function normalizeMcpDirectoryWidgetReadActionArguments(
  scope: string | undefined,
  input: {
    actionName: string;
    appId: string | undefined;
    resourceUri: string | undefined;
    args?: Record<string, unknown>;
    userEmail?: string;
    orgId?: string | null;
    allowedArgumentNames?: readonly string[];
    requireArgumentMatch?: boolean;
  },
): Record<string, unknown> | undefined {
  if (!scope || !input.appId || !input.resourceUri) return undefined;
  const actionArguments = widgetReadActionArgumentsForScope(scope);
  if (!actionArguments) return undefined;
  let capabilityAppId: string | undefined;
  let capabilityResourceUri: string | undefined;
  let capabilityUserEmail: string | undefined;
  let capabilityOrgId: string | undefined;
  if (isMcpDirectoryWidgetWriteCapabilityScope(scope)) {
    const capability = decodeMcpDirectoryWidgetWriteCapability(scope);
    capabilityAppId = capability?.appId;
    capabilityResourceUri = capability?.resourceUri;
    capabilityUserEmail = capability?.userEmail;
    capabilityOrgId = capability?.orgId;
  } else {
    const decoded = decodeMcpDirectoryWidgetReadCapability(scope);
    capabilityAppId = decoded.ok ? decoded.capability.appId : undefined;
    capabilityResourceUri = decoded.ok
      ? decoded.capability.resourceUri
      : undefined;
  }
  if (
    capabilityAppId !== input.appId ||
    capabilityResourceUri !== input.resourceUri ||
    (capabilityUserEmail &&
      capabilityUserEmail !== input.userEmail?.trim().toLowerCase()) ||
    (isMcpDirectoryWidgetWriteCapabilityScope(scope) &&
      capabilityOrgId !== (input.orgId ?? undefined))
  ) {
    return undefined;
  }
  const expectedArgs = actionArguments[input.actionName];
  if (!expectedArgs) return undefined;

  const allowedNames = [...(input.allowedArgumentNames ?? [])].sort();
  const expectedNames = Object.keys(expectedArgs).sort();
  if (
    allowedNames.length !== expectedNames.length ||
    allowedNames.some((name, index) => name !== expectedNames[index])
  ) {
    return undefined;
  }
  if (input.requireArgumentMatch === false) return input.args ?? {};

  const suppliedArgs = Object.entries(input.args ?? {});
  const hasSchemaArgument = Object.values(expectedArgs).some(
    (expected) =>
      typeof expected !== "string" && expected.type === "actionSchema",
  );
  const includesResourceBinding = suppliedArgs.some(
    ([name, value]) =>
      typeof expectedArgs[name] === "string" && expectedArgs[name] === value,
  );
  if (hasSchemaArgument && !includesResourceBinding) return undefined;
  if (suppliedArgs.length === 0) {
    return Object.keys(expectedArgs).length === 0 ? {} : undefined;
  }

  const normalizedArgs: Array<[string, unknown]> = [];
  for (const [name, value] of suppliedArgs) {
    if (!Object.hasOwn(expectedArgs, name)) return undefined;
    const expected = expectedArgs[name];
    if (typeof expected === "string") {
      if (expected !== value) return undefined;
      normalizedArgs.push([name, value]);
      continue;
    }
    if (expected.type === "actionSchema") {
      normalizedArgs.push([name, value]);
      continue;
    }
    if (expected.type === "actionSchemaResourceBound") return undefined;
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)
          ? Number(value)
          : Number.NaN;
    if (
      !Number.isSafeInteger(number) ||
      number < expected.min ||
      number > expected.max
    ) {
      return undefined;
    }
    normalizedArgs.push([name, number]);
  }
  return Object.fromEntries(normalizedArgs);
}

export function normalizeMcpDirectoryWidgetWriteActionArguments(
  scope: string | undefined,
  input: {
    actionName: string;
    appId: string | undefined;
    resourceUri: string | undefined;
    userEmail: string | undefined;
    orgId?: string | null;
    args?: Record<string, unknown>;
    allowedArgumentNames?: readonly string[];
  },
): Record<string, unknown> | undefined {
  if (
    !scope ||
    !isMcpDirectoryWidgetWriteCapabilityScope(scope) ||
    !input.appId ||
    !input.resourceUri ||
    !input.userEmail
  ) {
    return undefined;
  }
  const capability = decodeMcpDirectoryWidgetWriteCapability(scope);
  if (
    !capability ||
    capability.expiresAtMs <= Date.now() ||
    capability.appId !== input.appId ||
    capability.resourceUri !== input.resourceUri ||
    capability.userEmail !== input.userEmail.trim().toLowerCase() ||
    capability.orgId !== (input.orgId ?? undefined)
  ) {
    return undefined;
  }
  const expectedArgs = capability.writeActionArguments[input.actionName];
  if (!expectedArgs) return undefined;
  const allowedNames = [...(input.allowedArgumentNames ?? [])].sort();
  const expectedNames = Object.keys(expectedArgs).sort();
  if (
    allowedNames.length !== expectedNames.length ||
    allowedNames.some((name, index) => name !== expectedNames[index])
  ) {
    return undefined;
  }

  const suppliedArgs = Object.entries(input.args ?? {});
  const includesResourceBinding =
    suppliedArgs.some(
      ([name, value]) =>
        typeof expectedArgs[name] === "string" && expectedArgs[name] === value,
    ) ||
    Object.values(expectedArgs).some(
      (expected) =>
        typeof expected !== "string" &&
        expected.type === "actionSchemaResourceBound" &&
        Object.hasOwn(capability.resourceIds, expected.resourceKey),
    );
  if (!includesResourceBinding) return undefined;
  const normalizedArgs: Array<[string, unknown]> = [];
  for (const [name, value] of suppliedArgs) {
    if (!Object.hasOwn(expectedArgs, name)) return undefined;
    const expected = expectedArgs[name];
    if (typeof expected === "string") {
      if (expected !== value) return undefined;
      normalizedArgs.push([name, value]);
      continue;
    }
    if (
      expected.type === "actionSchema" ||
      expected.type === "actionSchemaResourceBound"
    ) {
      normalizedArgs.push([name, value]);
      continue;
    }
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)
          ? Number(value)
          : Number.NaN;
    if (
      !Number.isSafeInteger(number) ||
      number < expected.min ||
      number > expected.max
    ) {
      return undefined;
    }
    normalizedArgs.push([name, number]);
  }
  return Object.fromEntries(normalizedArgs);
}

export function allowsMcpDirectoryWidgetReadAction(
  scope: string | undefined,
  input: {
    actionName: string;
    appId: string | undefined;
    resourceUri: string | undefined;
    userEmail?: string;
    orgId?: string | null;
    args?: Record<string, unknown>;
    allowedArgumentNames?: readonly string[];
    requireArgumentMatch?: boolean;
  },
): boolean {
  return (
    normalizeMcpDirectoryWidgetReadActionArguments(scope, input) !== undefined
  );
}

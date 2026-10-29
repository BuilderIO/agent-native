import { getAppConfig } from "../app-config/store.js";
import { safeValue } from "../tracking/redaction.js";
import { listTrackingProviders, track } from "../tracking/registry.js";
import {
  DATABASE_FAILURE_MESSAGE,
  isDatabaseQueryFailure,
} from "./embed-redaction.js";

const CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";
const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";

export const MCP_ANALYTICS_EVENTS = {
  initialize: "$mcp_initialize",
  toolsList: "$mcp_tools_list",
  toolCall: "$mcp_tool_call",
  resourcesList: "$mcp_resources_list",
  resourceRead: "$mcp_resource_read",
  oauthAuthorizeOpened: "$mcp_oauth_authorize_opened",
  oauthLoginWallShown: "$mcp_oauth_login_wall_shown",
} as const;

export interface McpAnalyticsContext {
  source: "http" | "stdio";
  serverName: string;
  serverVersion?: string;
  appId?: string;
  clientName?: string;
  clientVersion?: string;
  clientUserAgent?: string;
  clientKey?: string;
  redirectHost?: string;
  protocolVersion?: string;
  userId?: string;
  anonymousId?: string;
  sessionId?: string;
}

interface McpRequestLike {
  params?: { _meta?: Record<string, unknown> } | undefined;
  _meta?: Record<string, unknown> | undefined;
}

const VENDOR_CLIENT_PATTERNS: Array<[RegExp, string]> = [
  [/claude[\s._-]?code/, "claude-code"],
  [/claude[\s._-]?desktop/, "claude-desktop"],
  [/\bclaude\b|anthropic/, "claude"],
  [/\bcodex\b/, "codex"],
  [/chatgpt|openai/, "openai"],
  [/\bcursor\b/, "cursor"],
  [/windsurf|codeium/, "windsurf"],
  [/\bcline\b/, "cline"],
  [/github[\s._-]?copilot|\bcopilot\b/, "copilot"],
  [/vscode|visual[\s._-]?studio[\s._-]?code/, "vscode"],
  [/jetbrains|intellij/, "jetbrains"],
  [/\bzed\b/, "zed"],
  [/\bgoose\b/, "goose"],
  [/\bpostman\b/, "postman"],
  [/mcpjam|mcp[\s._-]?inspector/, "mcp-inspector"],
  [/agent[\s._-]?native/, "agent-native"],
];

export function detectVendorClient(
  ...candidates: Array<string | undefined>
): string | undefined {
  const haystack = candidates
    .filter((value): value is string => !!value)
    .join(" ")
    .toLowerCase();
  if (!haystack) return undefined;
  for (const [pattern, vendor] of VENDOR_CLIENT_PATTERNS) {
    if (pattern.test(haystack)) return vendor;
  }
  return undefined;
}

// A known redirect host labels a vendor when the client's name does not (a
// client that points its callback at a domain it does not control cannot use
// the code). It is still the client's own registration, so it does not prove
// who the client is. Match the host itself or a subdomain, never a substring:
// that would credit `openai.evil.example`.
const REDIRECT_HOST_VENDORS: Array<[domain: string, vendor: string]> = [
  ["chatgpt.com", "openai"],
  ["openai.com", "openai"],
  ["claude.ai", "claude"],
];

export function vendorForRedirectHost(
  host: string | undefined,
): string | undefined {
  const name = host?.toLowerCase();
  if (!name) return undefined;
  return REDIRECT_HOST_VENDORS.find(
    ([domain]) => name === domain || name.endsWith(`.${domain}`),
  )?.[1];
}

export function readClientInfoFromRequest(
  request: McpRequestLike | undefined,
): {
  clientName?: string;
  clientVersion?: string;
  protocolVersion?: string;
} {
  const meta = request?.params?._meta ?? request?._meta;
  if (!meta || typeof meta !== "object") return {};
  const info = (meta as Record<string, unknown>)[CLIENT_INFO_META_KEY];
  const protocolVersion = (meta as Record<string, unknown>)[
    PROTOCOL_VERSION_META_KEY
  ];
  const record =
    info && typeof info === "object" ? (info as Record<string, unknown>) : {};
  return {
    ...(typeof record.name === "string" ? { clientName: record.name } : {}),
    ...(typeof record.version === "string"
      ? { clientVersion: record.version }
      : {}),
    ...(typeof protocolVersion === "string" ? { protocolVersion } : {}),
  };
}

function analyticsEnabled(): boolean {
  if (listTrackingProviders().length === 0) return false;
  return getAppConfig().observability.mcpEvents;
}

function captureParameters(): boolean {
  return getAppConfig().observability.mcpCaptureParameters;
}

function contextProperties(ctx: McpAnalyticsContext): Record<string, unknown> {
  // The client's name or user agent labels the vendor as it does on every other
  // MCP event, so the dimension stays consistent; a known redirect host labels
  // it only when they do not. On OAuth events (the ones with a redirect host)
  // `$mcp_vendor_source` says whether the host gave the same label. Neither
  // proves who the client is.
  const hostVendor = vendorForRedirectHost(ctx.redirectHost);
  const vendor = mcpVendorForContext(ctx);
  return {
    $mcp_source: ctx.source,
    $mcp_server_name: ctx.serverName,
    ...(ctx.serverVersion ? { $mcp_server_version: ctx.serverVersion } : {}),
    ...(ctx.appId ? { $mcp_app_id: ctx.appId } : {}),
    ...(ctx.clientName ? { $mcp_client_name: ctx.clientName } : {}),
    ...(ctx.clientVersion ? { $mcp_client_version: ctx.clientVersion } : {}),
    ...(ctx.clientUserAgent
      ? { $mcp_client_user_agent: ctx.clientUserAgent }
      : {}),
    ...(ctx.clientKey ? { $mcp_client_key: ctx.clientKey } : {}),
    ...(ctx.redirectHost ? { $mcp_redirect_host: ctx.redirectHost } : {}),
    ...(vendor ? { $mcp_vendor_client: vendor } : {}),
    ...(vendor && ctx.redirectHost
      ? {
          $mcp_vendor_source:
            hostVendor === vendor ? "redirect_host" : "client_name",
        }
      : {}),
    ...(ctx.protocolVersion
      ? { $mcp_protocol_version: ctx.protocolVersion }
      : {}),
  };
}

export function mcpVendorForContext(
  ctx: Pick<
    McpAnalyticsContext,
    "clientName" | "clientUserAgent" | "redirectHost"
  >,
): string | undefined {
  return (
    detectVendorClient(ctx.clientName, ctx.clientUserAgent) ??
    vendorForRedirectHost(ctx.redirectHost)
  );
}

function emit(
  event: string,
  ctx: McpAnalyticsContext,
  properties: Record<string, unknown>,
): void {
  try {
    track(
      event,
      { ...contextProperties(ctx), ...properties },
      {
        ...(ctx.userId ? { userId: ctx.userId } : {}),
        ...(ctx.anonymousId ? { anonymousId: ctx.anonymousId } : {}),
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      },
    );
  } catch (err) {
    console.error(`[mcp-analytics] Failed to emit ${event}:`, err);
  }
}

export function trackMcpInitialize(ctx: McpAnalyticsContext): void {
  if (!analyticsEnabled()) return;
  emit(MCP_ANALYTICS_EVENTS.initialize, ctx, {});
}

export function trackMcpToolsList(
  ctx: McpAnalyticsContext,
  args: { toolNames: string[]; durationMs: number },
): void {
  if (!analyticsEnabled()) return;
  emit(MCP_ANALYTICS_EVENTS.toolsList, ctx, {
    $mcp_listed_tool_names: args.toolNames,
    $mcp_listed_tool_count: args.toolNames.length,
    $mcp_duration_ms: args.durationMs,
  });
}

export function trackMcpToolCall(
  ctx: McpAnalyticsContext,
  args: {
    toolName: string;
    toolDescription?: string;
    toolCategory?: string;
    parameters?: Record<string, unknown>;
    durationMs: number;
    isError: boolean;
    errorType?: string;
    errorMessage?: string;
  },
): void {
  if (!analyticsEnabled()) return;
  emit(MCP_ANALYTICS_EVENTS.toolCall, ctx, {
    $mcp_tool_name: args.toolName,
    ...(args.toolDescription
      ? { $mcp_tool_description: args.toolDescription }
      : {}),
    ...(args.toolCategory ? { $mcp_tool_category: args.toolCategory } : {}),
    ...(captureParameters() && args.parameters
      ? { $mcp_parameters: safeValue(args.parameters) }
      : {}),
    $mcp_duration_ms: args.durationMs,
    $mcp_is_error: args.isError,
    ...(args.errorType ? { $mcp_error_type: args.errorType } : {}),
    ...(args.errorMessage ? { $mcp_error_message: args.errorMessage } : {}),
  });
}

export function trackMcpResourcesList(
  ctx: McpAnalyticsContext,
  args: { resourceCount: number; durationMs: number },
): void {
  if (!analyticsEnabled()) return;
  emit(MCP_ANALYTICS_EVENTS.resourcesList, ctx, {
    $mcp_listed_resource_count: args.resourceCount,
    $mcp_duration_ms: args.durationMs,
  });
}

export function trackMcpResourceRead(
  ctx: McpAnalyticsContext,
  args: {
    resourceName?: string;
    resourceUri?: string;
    durationMs: number;
    isError: boolean;
    errorType?: string;
    errorMessage?: string;
  },
): void {
  if (!analyticsEnabled()) return;
  emit(MCP_ANALYTICS_EVENTS.resourceRead, ctx, {
    ...(args.resourceName ? { $mcp_resource_name: args.resourceName } : {}),
    ...(args.resourceUri ? { $mcp_resource_uri: args.resourceUri } : {}),
    $mcp_duration_ms: args.durationMs,
    $mcp_is_error: args.isError,
    ...(args.errorType ? { $mcp_error_type: args.errorType } : {}),
    ...(args.errorMessage ? { $mcp_error_message: args.errorMessage } : {}),
  });
}

export type McpOAuthRoute = "directory" | "mcp";

// A new user's attempt serves two pages: the sign-in page (signedIn false, with
// a login wall) and, after sign-in, the consent page (signedIn true). A
// returning signed-in user sees only the consent page. So signedIn false counts
// signed-out arrivals and signedIn true counts everyone who reached consent,
// new and returning together; neither is "starts" on its own, and adding them
// double-counts new users.
export function trackMcpOAuthAuthorizeOpened(
  ctx: McpAnalyticsContext,
  args: { route: McpOAuthRoute; signedIn: boolean },
): void {
  if (!analyticsEnabled()) return;
  emit(MCP_ANALYTICS_EVENTS.oauthAuthorizeOpened, ctx, {
    $mcp_oauth_route: args.route,
    $mcp_oauth_signed_in: args.signedIn,
  });
}

export function trackMcpOAuthLoginWallShown(
  ctx: McpAnalyticsContext,
  args: { route: McpOAuthRoute },
): void {
  if (!analyticsEnabled()) return;
  emit(MCP_ANALYTICS_EVENTS.oauthLoginWallShown, ctx, {
    $mcp_oauth_route: args.route,
  });
}

export function describeMcpError(err: unknown): {
  errorType: string;
  errorMessage: string;
} {
  if (isDatabaseQueryFailure(err)) {
    return {
      errorType: "DrizzleQueryError",
      errorMessage: DATABASE_FAILURE_MESSAGE,
    };
  }
  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;
    const code = record.errorCode ?? record.code;
    return {
      errorType:
        typeof code === "string" && code
          ? code
          : ((err as Error).constructor?.name ?? "Error"),
      errorMessage: String(record.message ?? err),
    };
  }
  return { errorType: "Error", errorMessage: String(err) };
}

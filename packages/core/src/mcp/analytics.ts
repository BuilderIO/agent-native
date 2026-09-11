/**
 * Analytics for the MCP server this app exposes.
 *
 * Events and property names follow PostHog's MCP analytics vocabulary
 * (https://posthog.com/docs/mcp-analytics/events) — `$mcp_tool_call`,
 * `$mcp_tool_name`, `$mcp_duration_ms`, … — but they are emitted through the
 * framework's provider-agnostic `track()`, so an app on Mixpanel, Amplitude,
 * a webhook, or Agent-Native Analytics receives the same events under the
 * same names. The vocabulary is borrowed rather than invented because
 * PostHog's MCP dashboards read these keys directly, and a second spelling
 * would strand every app already built on theirs.
 *
 * Emission points live in `build-server.ts` (shared by the HTTP mount and the
 * stdio transport, so both surfaces report identically) and in `server.ts`
 * for the initialize handshake, which is the only place the client's own name
 * and version are on the wire.
 *
 * Deliberately NOT emitted: `$mcp_response`. A tool result is app data of
 * unbounded size; the properties here stay metadata. `$mcp_parameters` is
 * opt-in for the same reason (`observability.mcpCaptureParameters`) and
 * redacted
 * even then.
 */

import { getAppConfig } from "../app-config/store.js";
import { safeValue } from "../tracking/redaction.js";
import { listTrackingProviders, track } from "../tracking/registry.js";

/** Reserved request `_meta` keys the 2026-07-28 protocol carries per request. */
const CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";
const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";

export const MCP_ANALYTICS_EVENTS = {
  initialize: "$mcp_initialize",
  toolsList: "$mcp_tools_list",
  toolCall: "$mcp_tool_call",
  resourcesList: "$mcp_resources_list",
  resourceRead: "$mcp_resource_read",
} as const;

/**
 * Per-request identity of the MCP exchange: who is calling, over which
 * transport, against which server build. Resolved once per request and passed
 * to each event so every `$mcp_*` event carries the same caller columns.
 */
export interface McpAnalyticsContext {
  /** `$mcp_source` — which transport served the request. */
  source: "http" | "stdio";
  serverName: string;
  serverVersion: string;
  appId?: string;
  clientName?: string;
  clientVersion?: string;
  clientUserAgent?: string;
  protocolVersion?: string;
  /** Verified caller, when the request authenticated to one. */
  userId?: string;
  /** MCP transport session, when the transport keeps one. */
  sessionId?: string;
}

interface McpRequestLike {
  params?: { _meta?: Record<string, unknown> } | undefined;
  _meta?: Record<string, unknown> | undefined;
}

/**
 * Normalized vendor bucket for the calling host.
 *
 * Clients report themselves inconsistently — `claude-code`, `Claude Code`,
 * `claude-ai`, or nothing but a user agent — so grouping on the raw name
 * splits one host across several rows. Matching is substring-based against
 * the lowercased client name and user agent, first match wins.
 */
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

/** `{ name, version }` a 2026-era client carries in per-request `_meta`. */
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
  // A registry with no provider still fans out through `track()` at zero cost,
  // but building the property bag (redacting arguments, listing tool names) is
  // not free — skip it when nothing would receive the event.
  if (listTrackingProviders().length === 0) return false;
  // Not wrapped: a malformed `MCP_ANALYTICS` value is a deployment error, and
  // catching it here would turn "your config is wrong" into "MCP usage stopped
  // being reported" — the exact silent-off state this instrumentation exists to
  // rule out.
  return getAppConfig().observability.mcpEvents;
}

function captureParameters(): boolean {
  return getAppConfig().observability.mcpCaptureParameters;
}

function contextProperties(ctx: McpAnalyticsContext): Record<string, unknown> {
  const vendor = detectVendorClient(ctx.clientName, ctx.clientUserAgent);
  return {
    $mcp_source: ctx.source,
    $mcp_server_name: ctx.serverName,
    $mcp_server_version: ctx.serverVersion,
    ...(ctx.appId ? { $mcp_app_id: ctx.appId } : {}),
    ...(ctx.clientName ? { $mcp_client_name: ctx.clientName } : {}),
    ...(ctx.clientVersion ? { $mcp_client_version: ctx.clientVersion } : {}),
    ...(ctx.clientUserAgent
      ? { $mcp_client_user_agent: ctx.clientUserAgent }
      : {}),
    ...(vendor ? { $mcp_vendor_client: vendor } : {}),
    ...(ctx.protocolVersion
      ? { $mcp_protocol_version: ctx.protocolVersion }
      : {}),
  };
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
      { userId: ctx.userId, sessionId: ctx.sessionId },
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
    /** `read` for a `readOnly` action, `write` otherwise. */
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

/**
 * Error shape for a `$mcp_*` event.
 *
 * `$mcp_error_type` is the class/code a consumer can group by;
 * `$mcp_error_message` is bounded and redacted by the tracking layer's own
 * rules when it reaches a provider.
 */
export function describeMcpError(err: unknown): {
  errorType: string;
  errorMessage: string;
} {
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

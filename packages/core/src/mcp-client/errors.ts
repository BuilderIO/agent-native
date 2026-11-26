function stringifyError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = record.message;
    if (typeof message === "string" && message.trim()) return message;
    const type = record.type;
    if (typeof type === "string" && type.trim()) return type;
  }
  if (error === null || error === undefined) return "";
  try {
    return JSON.stringify(error);
  } catch (serializationError) {
    return serializationError instanceof Error
      ? `[unserializable: ${serializationError.message}]`
      : "[unserializable]";
  }
}

export function httpStatusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const nested =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : undefined;
  const status = record.status ?? nested?.status ?? record.code ?? nested?.code;
  return typeof status === "number" && status >= 100 && status <= 599
    ? status
    : undefined;
}

export function formatMcpConnectError(error: unknown): string {
  const raw = stringifyError(error);
  const text = raw.trim();
  const status = httpStatusFromError(error);
  const statusPrefix = status !== undefined ? `HTTP ${status}: ` : "";
  const hasStatusInText =
    status !== undefined &&
    new RegExp(`\\bHTTP(?:\\/\\d+(?:\\.\\d+)?)?\\s+${status}\\b`, "i").test(
      text,
    );
  const formattedText = hasStatusInText ? text : `${statusPrefix}${text}`;
  if (!text) {
    return `${statusPrefix}Could not connect to that MCP server.`;
  }
  if (
    /<!doctype|<html[\s>]|<\/html>|unexpected token '<'|is not valid json/i.test(
      text,
    )
  ) {
    return `${statusPrefix}That URL returned a web page instead of an MCP response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.`;
  }
  if (
    /invalid_union|unrecognized_keys|invalid_type|invalid_value/i.test(text) &&
    /jsonrpc|method|unrecognized keys|args|origin|url/i.test(text)
  ) {
    return `${statusPrefix}That URL returned JSON, but not an MCP JSON-RPC response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.`;
  }
  if (/401|403|unauthorized|forbidden/i.test(text)) {
    return `${statusPrefix}The MCP server rejected the request. Reconnect or update the required Authorization header.`;
  }
  if (
    /streamable http/i.test(text) &&
    /error|failed|non-200|status/i.test(text)
  ) {
    return `${statusPrefix}The server did not complete the Streamable HTTP MCP handshake. Check the URL and any required authorization headers.`;
  }
  if (
    /failed to fetch|fetch failed|networkerror|econnrefused|enotfound|timed out/i.test(
      text,
    )
  ) {
    return `${statusPrefix}Could not reach that MCP server. Check the URL and make sure it is publicly reachable from this app.`;
  }
  if (/404|not found|405|method not allowed/i.test(text)) {
    return `${statusPrefix}That URL is reachable, but it does not look like the MCP endpoint. Check the server's Streamable HTTP path.`;
  }
  if (text === "[object ErrorEvent]" || text === "error") {
    return `${statusPrefix}The MCP server connection failed while opening its event stream. Check the URL and any required authorization headers.`;
  }
  return formattedText.length > 240
    ? `${formattedText.slice(0, 237).trimEnd()}...`
    : formattedText;
}

/** Reason a dispatched MCP tool call lost its session or transport before receiving a response. */
export type McpToolCallDisconnectReason =
  | "session_expired"
  | "transport_disconnect";

const TRANSPORT_DISCONNECT_CODES = new Set<string | number>([
  "ECONNRESET",
  "EPIPE",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ENETRESET",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_DESTROYED",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  -32000,
]);

const TRANSPORT_DISCONNECT_MESSAGE_RE =
  /\b(?:connection closed|transport closed|transport is closed|socket hang up|econnreset|epipe|broken pipe|stream closed|client is not connected)\b/i;

function checkTransportDisconnectError(
  error: unknown,
  visited: Set<unknown>,
): boolean {
  if (!error || typeof error !== "object" || visited.has(error)) return false;
  visited.add(error);
  if (httpStatusFromError(error) !== undefined) return false;
  const record = error as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (typeof record.code === "number") {
    return record.code === -32000;
  }
  if (
    typeof record.code === "string" &&
    TRANSPORT_DISCONNECT_CODES.has(record.code)
  ) {
    return true;
  }
  if (
    typeof record.message === "string" &&
    TRANSPORT_DISCONNECT_MESSAGE_RE.test(record.message)
  ) {
    return true;
  }
  if (record.cause !== undefined) {
    return checkTransportDisconnectError(record.cause, visited);
  }
  return false;
}

/** Returns true when an error indicates a dropped MCP transport rather than an application or HTTP error. */
export function isMcpTransportDisconnectError(error: unknown): boolean {
  return checkTransportDisconnectError(error, new Set());
}

/** Parameters used to construct `McpToolCallReplayRefusedError`. */
export interface McpToolCallReplayRefusedErrorInit {
  serverId: string;
  toolName: string;
  reason: McpToolCallDisconnectReason;
  reconnected: boolean;
  reconnectError?: string | undefined;
  cause: unknown;
}

/**
 * Raised when a dispatched MCP tool call fails due to session expiry or transport
 * disconnect and cannot be automatically replayed because the call may have side effects.
 */
export class McpToolCallReplayRefusedError extends Error {
  readonly code = "MCP_TOOL_CALL_REPLAY_REFUSED" as const;
  readonly serverId: string;
  readonly toolName: string;
  readonly reason: McpToolCallDisconnectReason;
  readonly reconnected: boolean;
  readonly reconnectError?: string | undefined;
  readonly status?: number | undefined;
  override readonly cause: unknown;

  constructor(init: McpToolCallReplayRefusedErrorInit) {
    const reasonLabel =
      init.reason === "session_expired"
        ? "session expired"
        : "transport disconnected";
    const reconnectSuffix = init.reconnected
      ? "Reconnected for subsequent calls."
      : init.reconnectError
        ? `Reconnect failed: ${init.reconnectError}`
        : "Connection was not restored.";
    super(
      `MCP tool "${init.serverId}/${init.toolName}" failed after dispatch (${reasonLabel}) and was not automatically replayed to avoid duplicate side effects. ${reconnectSuffix}`,
      { cause: init.cause },
    );
    this.name = "McpToolCallReplayRefusedError";
    this.serverId = init.serverId;
    this.toolName = init.toolName;
    this.reason = init.reason;
    this.reconnected = init.reconnected;
    this.reconnectError = init.reconnectError;
    this.status = httpStatusFromError(init.cause);
    this.cause = init.cause;
  }
}

/** Type guard for `McpToolCallReplayRefusedError`. */
export function isMcpToolCallReplayRefusedError(
  error: unknown,
): error is McpToolCallReplayRefusedError {
  return error instanceof McpToolCallReplayRefusedError;
}

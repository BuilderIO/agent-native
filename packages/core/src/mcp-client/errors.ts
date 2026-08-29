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

function httpStatusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const nested = record.data;
  const status =
    record.status ??
    (nested && typeof nested === "object"
      ? (nested as Record<string, unknown>).status
      : undefined);
  return typeof status === "number" && status >= 100 && status <= 599
    ? status
    : undefined;
}

export function formatMcpConnectError(error: unknown): string {
  const raw = stringifyError(error);
  const text = raw.trim();
  const status = httpStatusFromError(error);
  const statusPrefix =
    status !== undefined &&
    !new RegExp(`\\bHTTP(?:\\/\\d+(?:\\.\\d+)?)?\\s+${status}\\b`, "i").test(
      text,
    )
      ? `HTTP ${status}: `
      : "";
  const formattedText = `${statusPrefix}${text}`;
  if (!formattedText) return "Could not connect to that MCP server.";
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
    return "The MCP server connection failed while opening its event stream. Check the URL and any required authorization headers.";
  }
  return formattedText.length > 240
    ? `${formattedText.slice(0, 237).trimEnd()}...`
    : formattedText;
}

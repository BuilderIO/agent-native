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
  return String(error ?? "");
}

export function formatMcpConnectError(error: unknown): string {
  const raw = stringifyError(error);
  const text = raw.trim();
  if (!text) return "Could not connect to that MCP server.";
  if (
    /<!doctype|<html[\s>]|<\/html>|unexpected token '<'|is not valid json/i.test(
      text,
    )
  ) {
    return "That URL returned a web page instead of an MCP response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.";
  }
  if (
    /invalid_union|unrecognized_keys|invalid_type|invalid_value/i.test(text) &&
    /jsonrpc|method|unrecognized keys|args|origin|url/i.test(text)
  ) {
    return "That URL returned JSON, but not an MCP JSON-RPC response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.";
  }
  if (
    /streamable http/i.test(text) &&
    /error|failed|non-200|status/i.test(text)
  ) {
    return "The server did not complete the Streamable HTTP MCP handshake. Check the URL and any required authorization headers.";
  }
  if (
    /failed to fetch|fetch failed|networkerror|econnrefused|enotfound|timed out/i.test(
      text,
    )
  ) {
    return "Could not reach that MCP server. Check the URL and make sure it is publicly reachable from this app.";
  }
  if (/401|403|unauthorized|forbidden/i.test(text)) {
    return "The MCP server rejected the request. Add or update the required Authorization header.";
  }
  if (/404|not found|405|method not allowed/i.test(text)) {
    return "That URL is reachable, but it does not look like the MCP endpoint. Check the server's Streamable HTTP path.";
  }
  if (text === "[object ErrorEvent]" || text === "error") {
    return "The MCP server connection failed while opening its event stream. Check the URL and any required authorization headers.";
  }
  return text.length > 240 ? `${text.slice(0, 237).trimEnd()}...` : text;
}

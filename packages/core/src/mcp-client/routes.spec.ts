import { describe, expect, it } from "vitest";
import { formatMcpConnectError } from "./routes.js";

describe("formatMcpConnectError", () => {
  it("does not surface raw HTML responses", () => {
    expect(formatMcpConnectError("<!doctype html><html>Not found</html>")).toBe(
      "That URL returned a web page instead of an MCP response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.",
    );
  });

  it("explains Streamable HTTP handshake failures", () => {
    expect(
      formatMcpConnectError("Streamable HTTP error: non-200 status code"),
    ).toBe(
      "The server did not complete the Streamable HTTP MCP handshake. Check the URL and any required authorization headers.",
    );
  });

  it("explains non-MCP JSON responses", () => {
    expect(
      formatMcpConnectError(
        '[{"code":"invalid_union","path":["jsonrpc"],"message":"Invalid input"},{"code":"unrecognized_keys","keys":["args","origin","url"]}]',
      ),
    ).toBe(
      "That URL returned JSON, but not an MCP JSON-RPC response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.",
    );
  });
});

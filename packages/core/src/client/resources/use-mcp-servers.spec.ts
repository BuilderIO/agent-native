import { describe, expect, it } from "vitest";

import {
  formatMcpServerError,
  getMcpUrlValidationError,
} from "./use-mcp-servers.js";

describe("MCP server UI helpers", () => {
  it("validates complete MCP URLs before submitting", () => {
    expect(getMcpUrlValidationError("mcp.example.com")).toBe(
      "Enter a full URL, including https://.",
    );
    expect(getMcpUrlValidationError("http://mcp.example.com")).toBe(
      "Use https:// for remote MCP servers. Plain http:// is only allowed for localhost.",
    );
    expect(getMcpUrlValidationError("https://mcp.example.com/mcp")).toBeNull();
  });

  it("converts raw HTML errors into endpoint guidance", () => {
    expect(formatMcpServerError("<html><body>Not MCP</body></html>")).toBe(
      "That URL returned a web page instead of an MCP response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.",
    );
  });
});

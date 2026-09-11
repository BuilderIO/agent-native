import { describe, expect, it } from "vitest";

import {
  MCP_LEGACY_ROUTE_PREFIX,
  MCP_PUBLIC_ROUTE_PREFIX,
  MCP_ROUTE_PREFIXES,
  isMcpProtocolPath,
  joinMcpRoute,
} from "./route-paths.js";

describe("MCP route paths", () => {
  it("keeps the legacy protocol path alongside the public path", () => {
    expect(MCP_ROUTE_PREFIXES).toEqual([
      MCP_LEGACY_ROUTE_PREFIX,
      MCP_PUBLIC_ROUTE_PREFIX,
    ]);
    expect(isMcpProtocolPath("/mcp")).toBe(true);
    expect(isMcpProtocolPath("/_agent-native/mcp")).toBe(true);
    expect(isMcpProtocolPath("/mcp/oauth/token")).toBe(false);
  });

  it("joins custom route prefixes without changing their semantics", () => {
    expect(joinMcpRoute("/_agent-native", "/mcp")).toBe("/_agent-native/mcp");
    expect(joinMcpRoute("/custom", "mcp")).toBe("/custom/mcp");
    expect(joinMcpRoute("", "/mcp")).toBe("/mcp");
  });
});

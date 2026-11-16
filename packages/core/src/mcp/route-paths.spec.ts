import { describe, expect, it } from "vitest";

import {
  MCP_DIRECTORY_ROUTE_PREFIX,
  MCP_LEGACY_ROUTE_PREFIX,
  MCP_PUBLIC_ROUTE_PREFIX,
  MCP_ROUTE_PREFIXES,
  isMcpPageNavigation,
  isMcpProtocolPath,
  joinMcpRoute,
} from "./route-paths.js";

describe("MCP route paths", () => {
  it("keeps the public, directory, and legacy protocol paths exact", () => {
    expect(MCP_ROUTE_PREFIXES).toEqual([
      MCP_LEGACY_ROUTE_PREFIX,
      MCP_PUBLIC_ROUTE_PREFIX,
    ]);
    expect(isMcpProtocolPath("/mcp")).toBe(true);
    expect(isMcpProtocolPath("/_agent-native/mcp")).toBe(true);
    expect(isMcpProtocolPath(MCP_DIRECTORY_ROUTE_PREFIX)).toBe(true);
    expect(isMcpProtocolPath(`${MCP_DIRECTORY_ROUTE_PREFIX}/`)).toBe(true);
    expect(isMcpProtocolPath("/mcp/oauth/token")).toBe(false);
    expect(isMcpProtocolPath(`${MCP_DIRECTORY_ROUTE_PREFIX}/other`)).toBe(
      false,
    );
  });

  it("joins custom route prefixes without changing their semantics", () => {
    expect(joinMcpRoute("/_agent-native", "/mcp")).toBe("/_agent-native/mcp");
    expect(joinMcpRoute("/custom", "mcp")).toBe("/custom/mcp");
    expect(joinMcpRoute("", "/mcp")).toBe("/mcp");
  });

  it("hands a browser page load of /mcp to the app and keeps MCP traffic on the server", () => {
    const headers = (init: Record<string, string>) => (name: string) =>
      new Headers(init).get(name);
    const page = headers({
      "sec-fetch-dest": "document",
      accept: "text/html,application/xhtml+xml",
    });
    expect(isMcpPageNavigation("/mcp", "GET", page)).toBe(true);
    expect(isMcpPageNavigation("/mcp", "POST", page)).toBe(false);
    expect(isMcpPageNavigation("/mcp/oauth/authorize", "GET", page)).toBe(
      false,
    );
    expect(
      isMcpPageNavigation(
        "/mcp",
        "GET",
        headers({ accept: "text/event-stream" }),
      ),
    ).toBe(false);
    expect(isMcpPageNavigation("/mcp", "GET", headers({ accept: "*/*" }))).toBe(
      false,
    );
  });
});

import type { McpServer } from "@agent-native/core/client/resources";
import { describe, expect, it } from "vitest";

import {
  canManageGongConnection,
  hasConnectedGongMcpServer,
} from "./gong-connection";

function server(
  overrides: Partial<McpServer> & Pick<McpServer, "url">,
): McpServer {
  return {
    id: "gong-server",
    scope: "user",
    name: "Gong",
    authMode: "oauth",
    createdAt: 0,
    mergedId: "gong-server",
    status: { state: "connected", toolCount: 3 },
    ...overrides,
  };
}

describe("Gong MCP connection visibility", () => {
  it.each(["owner", "admin"])(
    "allows the workspace %s to connect Gong",
    (role) => {
      expect(
        canManageGongConnection({
          user: [],
          org: [],
          orgId: "org-1",
          role,
        }),
      ).toBe(true);
    },
  );

  it("hides Gong setup from workspace members and when permissions are unknown", () => {
    expect(
      canManageGongConnection({
        user: [],
        org: [],
        orgId: "org-1",
        role: "member",
      }),
    ).toBe(false);
    expect(canManageGongConnection(undefined)).toBe(false);
  });

  it("allows a personal connection when there is no workspace", () => {
    expect(
      canManageGongConnection({
        user: [],
        org: [],
        orgId: null,
        role: null,
      }),
    ).toBe(true);
  });

  it("recognizes only an active connection to Gong MCP", () => {
    const servers = {
      user: [server({ url: "https://mcp.gong.io/mcp/" })],
      org: [],
      orgId: null,
      role: null,
    };

    expect(hasConnectedGongMcpServer(servers)).toBe(true);
    expect(
      hasConnectedGongMcpServer({
        ...servers,
        user: [
          server({
            url: "https://mcp.gong.io/mcp",
            status: { state: "error", error: "not connected" },
          }),
        ],
      }),
    ).toBe(false);
    expect(
      hasConnectedGongMcpServer({
        ...servers,
        user: [server({ url: "https://example.com/mcp" })],
      }),
    ).toBe(false);
  });
});

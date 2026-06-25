import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseMergedKey } from "./remote-store.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  readAppSecret: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: (...args: any[]) => mocks.readAppSecret(...args),
}));

describe("loadWorkspaceMcpServers", () => {
  const previousAppId = process.env.AGENT_NATIVE_WORKSPACE_APP_ID;

  beforeEach(() => {
    process.env.AGENT_NATIVE_WORKSPACE_APP_ID = "analytics";
    mocks.execute.mockReset();
    mocks.readAppSecret.mockReset();
    mocks.readAppSecret.mockImplementation(async (ref: any) =>
      ref.key === "ZAPIER_TOKEN" &&
      ref.scope === "org" &&
      ref.scopeId === "acme"
        ? { value: "secret-zapier", last4: "pier", updatedAt: 1 }
        : null,
    );
  });

  afterEach(() => {
    if (previousAppId === undefined) {
      delete process.env.AGENT_NATIVE_WORKSPACE_APP_ID;
    } else {
      process.env.AGENT_NATIVE_WORKSPACE_APP_ID = previousAppId;
    }
  });

  it("hydrates all-app and app-granted workspace MCP resources as scoped HTTP servers", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            id: "res_zapier",
            owner_email: "owner@example.test",
            org_id: "acme",
            name: "Zapier",
            description: "Workspace Zapier MCP",
            path: "mcp-servers/zapier.json",
            content: JSON.stringify({
              type: "http",
              url: "https://mcp.zapier.example/mcp",
              headers: {
                Authorization: "Bearer ${keys.ZAPIER_TOKEN}",
              },
            }),
            scope: "all",
            updated_at: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "res_linear",
            owner_email: "owner@example.test",
            org_id: "acme",
            name: "Linear",
            description: null,
            path: "mcp-servers/linear.json",
            content: JSON.stringify({
              servers: {
                linear: {
                  type: "http",
                  url: "https://linear.example/mcp",
                },
              },
            }),
            scope: "selected",
            updated_at: 3,
            grant_id: "grant_linear",
            app_id: "analytics",
          },
        ],
      });

    const { loadWorkspaceMcpServers } = await import("./workspace-servers.js");
    const servers = await loadWorkspaceMcpServers({
      userEmail: "owner@example.test",
      orgId: "acme",
    });
    const keys = Object.keys(servers).sort();

    expect(keys).toHaveLength(2);
    const zapierKey = keys.find((key) => key.includes("workspace-zapier-"));
    const linearKey = keys.find((key) => key.includes("workspace-linear-"));
    expect(zapierKey).toBeTruthy();
    expect(linearKey).toBeTruthy();
    expect(parseMergedKey(zapierKey!)).toMatchObject({
      scope: "org",
      owner: "acme",
    });
    expect(servers[zapierKey!]).toEqual({
      type: "http",
      url: "https://mcp.zapier.example/mcp",
      headers: { Authorization: "Bearer secret-zapier" },
      description: "Workspace Zapier MCP",
    });
    expect(servers[linearKey!]).toMatchObject({
      type: "http",
      url: "https://linear.example/mcp",
    });
  });

  it("does not load selected resources without a matching app id", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });

    const { loadWorkspaceMcpServers } = await import("./workspace-servers.js");
    const servers = await loadWorkspaceMcpServers({ workspaceAppId: null });

    expect(servers).toEqual({});
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("scopes all-app workspace MCP resources to the current org or user", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          id: "res_acme",
          owner_email: "owner@example.test",
          org_id: "acme",
          name: "Acme",
          description: null,
          path: "mcp-servers/acme.json",
          content: JSON.stringify({
            type: "http",
            url: "https://acme.example/mcp",
          }),
          scope: "all",
          updated_at: 2,
        },
      ],
    });
    mocks.execute.mockResolvedValueOnce({ rows: [] });

    const { loadWorkspaceMcpServers } = await import("./workspace-servers.js");
    const servers = await loadWorkspaceMcpServers({
      userEmail: "owner@example.test",
      orgId: "acme",
    });

    expect(Object.keys(servers)).toHaveLength(1);
    expect(mocks.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        args: [
          "mcp-server",
          "all",
          "mcp-servers/%",
          "acme",
          "acme",
          "owner@example.test",
          "owner@example.test",
        ],
      }),
    );
  });
});

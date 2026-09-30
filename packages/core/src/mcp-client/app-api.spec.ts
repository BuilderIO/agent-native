import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import { callMcpTool, listVisibleMcpTools, McpAppApiError } from "./app-api.js";

const mockedManager = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

vi.mock("../server/agent-chat/mcp-glue.js", () => ({
  getMcpManagerForPrincipal: mockedManager.resolve,
}));

const callTool = vi.fn(async () => ({
  content: [{ type: "text", text: "ok" }],
}));

const tools = [
  {
    source: "org_acme_mcp",
    name: "mcp__org_acme_mcp__inspect",
    originalName: "inspect",
    description: "Inspect the current state",
    inputSchema: { type: "object" },
    raw: {
      name: "inspect",
      _meta: { ui: { visibility: ["app"] } },
    },
  },
  {
    source: "org_acme_mcp",
    name: "mcp__org_acme_mcp__model-only",
    originalName: "model-only",
    description: "Model-only tool",
    inputSchema: { type: "object" },
    raw: {
      name: "model-only",
      _meta: { ui: { visibility: ["model"] } },
    },
  },
] as any;

const manager = {
  getTools: () => tools,
  getToolsForServer: (serverId: string) =>
    tools.filter((tool: any) => tool.source === serverId),
  callTool,
};

beforeEach(() => {
  callTool.mockClear();
  mockedManager.resolve.mockReset().mockResolvedValue(manager);
});

describe("MCP app API", () => {
  it("requires an authenticated request context even when a CLI env identity exists", async () => {
    await expect(listVisibleMcpTools()).rejects.toMatchObject<McpAppApiError>({
      statusCode: 401,
    });
    expect(mockedManager.resolve).not.toHaveBeenCalled();
  });

  it("rejects an anonymous identity before resolving any MCP manager", async () => {
    await expect(
      runWithRequestContext(
        { userEmail: "anon-session@agent-native.com", agentRunAnonymous: true },
        () => listVisibleMcpTools(),
      ),
    ).rejects.toMatchObject<McpAppApiError>({ statusCode: 401 });
    expect(mockedManager.resolve).not.toHaveBeenCalled();
  });

  it("lists only request-visible app tools without raw manager data", async () => {
    const result = await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "acme" },
      () => listVisibleMcpTools(),
    );

    expect(result).toEqual([
      expect.objectContaining({
        serverId: "org_acme_mcp",
        name: "inspect",
        description: "Inspect the current state",
      }),
    ]);
    expect(result[0]).not.toHaveProperty("raw");
    expect(result[0]).not.toHaveProperty("config");
  });

  it("resolves the authenticated caller's manager before reading app tools", async () => {
    let initialized = false;
    const lazyManager = {
      getTools: () => (initialized ? tools : []),
      getToolsForServer: (serverId: string) =>
        initialized
          ? tools.filter((tool: any) => tool.source === serverId)
          : [],
      callTool,
    };
    mockedManager.resolve.mockImplementation(async () => {
      initialized = true;
      return lazyManager;
    });

    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "acme" },
      async () => {
        await expect(listVisibleMcpTools()).resolves.toHaveLength(1);
        expect(initialized).toBe(true);
      },
    );
    expect(mockedManager.resolve).toHaveBeenCalledWith({
      userEmail: "alice@example.com",
      orgId: "acme",
    });
  });

  it("fails closed when an org-scoped request has no active org", async () => {
    await expect(
      runWithRequestContext({ userEmail: "alice@example.com" }, () =>
        listVisibleMcpTools(),
      ),
    ).resolves.toEqual([]);
  });

  it("calls by server id and original tool name after visibility checks", async () => {
    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "acme" },
      async () => {
        await expect(
          callMcpTool("org_acme_mcp", "inspect", { id: "1" }),
        ).resolves.toEqual({ content: [{ type: "text", text: "ok" }] });
      },
    );

    expect(callTool).toHaveBeenCalledWith("mcp__org_acme_mcp__inspect", {
      id: "1",
    });
  });

  it("rejects model-only and unknown tools without calling the manager", async () => {
    await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "acme" },
      async () => {
        await expect(
          callMcpTool("org_acme_mcp", "model-only"),
        ).rejects.toMatchObject({ statusCode: 403 });
        await expect(
          callMcpTool("org_acme_mcp", "missing"),
        ).rejects.toMatchObject({
          statusCode: 403,
        });
      },
    );
    expect(callTool).not.toHaveBeenCalled();
  });
});

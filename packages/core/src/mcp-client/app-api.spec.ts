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

const serverConfigs: Record<string, unknown> = {
  org_acme_mcp: { type: "http", url: "https://mcp.acme.example/mcp" },
};

const manager = {
  getTools: () => tools,
  getToolsForServer: (serverId: string) =>
    tools.filter((tool: any) => tool.source === serverId),
  getServerConfig: (serverId: string) => serverConfigs[serverId] ?? null,
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

  describe("provider filter", () => {
    const askAccount = (source: string) => ({
      source,
      name: `mcp__${source}__ask_account`,
      originalName: "ask_account",
      description: "Ask about an account",
      inputSchema: { type: "object" },
      raw: { name: "ask_account" },
    });
    const providerTools = [
      askAccount("org_acme_gong"),
      // Named like Gong, served from somewhere else.
      askAccount("org_acme_gong-lookalike"),
      askAccount("org_acme_stdio-gong"),
    ];
    const providerManager = {
      getTools: () => providerTools,
      getToolsForServer: (serverId: string) =>
        providerTools.filter((tool) => tool.source === serverId),
      getServerConfig: (serverId: string) =>
        ({
          org_acme_gong: { type: "http", url: "https://mcp.gong.io/mcp" },
          "org_acme_gong-lookalike": {
            type: "http",
            url: "https://mcp.example.test/gong/mcp",
          },
          "org_acme_stdio-gong": { type: "stdio", command: "gong-mcp" },
        })[serverId] ?? null,
      callTool,
    };

    beforeEach(() => {
      mockedManager.resolve.mockResolvedValue(providerManager);
    });

    it("lists only tools whose server URL belongs to the provider", async () => {
      const result = await runWithRequestContext(
        { userEmail: "alice@example.com", orgId: "acme" },
        () => listVisibleMcpTools({ providerId: "gong" }),
      );

      expect(result.map((tool) => tool.serverId)).toEqual(["org_acme_gong"]);
    });

    it("refuses to call a same-named tool on another provider's server", async () => {
      await runWithRequestContext(
        { userEmail: "alice@example.com", orgId: "acme" },
        async () => {
          await expect(
            callMcpTool(
              "org_acme_gong-lookalike",
              "ask_account",
              {},
              { providerId: "gong" },
            ),
          ).rejects.toMatchObject({ statusCode: 403 });
          await expect(
            callMcpTool(
              "org_acme_stdio-gong",
              "ask_account",
              {},
              { providerId: "gong" },
            ),
          ).rejects.toMatchObject({ statusCode: 403 });
        },
      );
      expect(callTool).not.toHaveBeenCalled();
    });

    it("calls the provider's own server", async () => {
      await runWithRequestContext(
        { userEmail: "alice@example.com", orgId: "acme" },
        () =>
          callMcpTool(
            "org_acme_gong",
            "ask_account",
            {},
            { providerId: "gong" },
          ),
      );

      expect(callTool).toHaveBeenCalledWith(
        "mcp__org_acme_gong__ask_account",
        {},
      );
    });

    it("rejects a provider id with no URL match rules", async () => {
      await expect(
        runWithRequestContext(
          { userEmail: "alice@example.com", orgId: "acme" },
          () => listVisibleMcpTools({ providerId: "not-a-provider" }),
        ),
      ).rejects.toThrow(/No MCP provider match rules/);
    });
  });
});

import { mockEvent } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../request-context.js";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOrgContext: vi.fn(),
}));
const mockedMcp = vi.hoisted(() => {
  const managers: Array<{
    config: unknown;
    reconfigure: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    managers,
    buildMergedConfig: vi.fn(),
  };
});

vi.mock("../auth.js", () => ({ getSession: authMocks.getSession }));
vi.mock("../../org/context.js", () => ({
  getOrgContext: authMocks.getOrgContext,
}));
vi.mock("../../mcp-client/index.js", () => ({
  buildMergedConfig: mockedMcp.buildMergedConfig,
  getHubStatus: vi.fn(),
  McpClientManager: class {
    config: unknown;
    reconfigure = vi.fn(async (config: unknown) => {
      this.config = config;
    });
    getStatus = vi.fn(() => ({ principal: (this.config as any)?.source }));
    stop = vi.fn(async () => {});

    constructor(config: unknown) {
      this.config = config;
      mockedMcp.managers.push(this);
    }
  },
  McpConfigUnreadableError: class extends Error {},
}));

vi.mock("../framework-request-handler.js", () => ({
  getH3App: (app: { h3: unknown }) => app.h3,
}));

import {
  invalidateMcpManagersForScope,
  _resetMcpManagerRegistryForTests,
  getMcpManagerForCurrentRequest,
  getMcpManagerForPrincipal,
  refreshMcpManagerForPrincipal,
  resolveBackgroundMcpToolSelection,
} from "./mcp-glue.js";

describe("principal-scoped MCP managers", () => {
  beforeEach(async () => {
    await _resetMcpManagerRegistryForTests();
    authMocks.getSession.mockReset();
    authMocks.getOrgContext.mockReset();
    mockedMcp.managers.length = 0;
    mockedMcp.buildMergedConfig.mockReset();
    mockedMcp.buildMergedConfig.mockImplementation(
      async (principal: { userEmail: string; orgId: string | null }) => ({
        source: principal.userEmail,
        servers: {},
      }),
    );
  });

  afterEach(async () => {
    await _resetMcpManagerRegistryForTests();
  });

  it("caches managers by caller and organization, never merging another user's config", async () => {
    const alice = await getMcpManagerForPrincipal({
      userEmail: "alice@example.com",
      orgId: "acme",
    });
    const aliceAgain = await getMcpManagerForPrincipal({
      userEmail: "alice@example.com",
      orgId: "acme",
    });
    const bob = await getMcpManagerForPrincipal({
      userEmail: "bob@example.com",
      orgId: "acme",
    });

    expect(aliceAgain).toBe(alice);
    expect(bob).not.toBe(alice);
    expect(mockedMcp.buildMergedConfig.mock.calls).toEqual([
      [{ userEmail: "alice@example.com", orgId: "acme" }],
      [{ userEmail: "bob@example.com", orgId: "acme" }],
    ]);
  });

  it("invalidates same-org managers after an org server is changed", async () => {
    const alice = await getMcpManagerForPrincipal({
      userEmail: "alice@example.com",
      orgId: "acme",
    });
    const bob = await getMcpManagerForPrincipal({
      userEmail: "bob@example.com",
      orgId: "acme",
    });
    const otherOrg = await getMcpManagerForPrincipal({
      userEmail: "bob@example.com",
      orgId: "other",
    });

    await invalidateMcpManagersForScope("org", "acme", alice);

    expect(alice.stop).not.toHaveBeenCalled();
    expect(bob.stop).toHaveBeenCalledOnce();
    expect(otherOrg.stop).not.toHaveBeenCalled();
    expect(
      await getMcpManagerForPrincipal({
        userEmail: "bob@example.com",
        orgId: "acme",
      }),
    ).not.toBe(bob);
  });

  it("stops an invalidated manager after its pending hydration settles", async () => {
    let resolveConfig!: (config: unknown) => void;
    mockedMcp.buildMergedConfig.mockImplementationOnce(
      () => new Promise((resolve) => (resolveConfig = resolve)),
    );
    const pending = getMcpManagerForPrincipal({
      userEmail: "alice@example.com",
      orgId: "acme",
    });
    const result = pending.then(
      () => null,
      (error) => error,
    );
    await Promise.resolve();
    const manager = mockedMcp.managers[0]!;
    const invalidation = invalidateMcpManagersForScope("org", "acme");

    await Promise.resolve();
    expect(manager.stop).not.toHaveBeenCalled();
    resolveConfig({ source: "alice@example.com", servers: {} });

    expect(await result).toBeInstanceOf(Error);
    await invalidation;
    expect(manager.reconfigure).not.toHaveBeenCalled();
    expect(manager.stop).toHaveBeenCalledOnce();
  });

  it("refreshes only managers for the changed principal scope", async () => {
    const alice = await getMcpManagerForPrincipal({
      userEmail: "alice@example.com",
      orgId: "acme",
    });
    const bob = await getMcpManagerForPrincipal({
      userEmail: "bob@example.com",
      orgId: "acme",
    });
    const otherOrg = await getMcpManagerForPrincipal({
      userEmail: "bob@example.com",
      orgId: "other",
    });

    await expect(
      refreshMcpManagerForPrincipal({
        userEmail: "alice@example.com",
        orgId: "acme",
      }),
    ).resolves.toBe(true);

    expect(alice.stop).toHaveBeenCalledOnce();
    expect(bob.stop).toHaveBeenCalledOnce();
    expect(otherOrg.stop).not.toHaveBeenCalled();
    expect(mockedMcp.buildMergedConfig).toHaveBeenLastCalledWith({
      userEmail: "alice@example.com",
      orgId: "acme",
    });
  });

  it("requires an authenticated non-anonymous principal", async () => {
    await expect(
      getMcpManagerForPrincipal({
        userEmail: "anon-viewer@agent-native.com",
        orgId: "acme",
      }),
    ).rejects.toThrow("Authenticated MCP principal required");
    expect(mockedMcp.buildMergedConfig).not.toHaveBeenCalled();
    expect(mockedMcp.managers).toHaveLength(0);
  });

  it("does not hydrate MCP for an anonymous chat request context", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "anon-viewer@agent-native.com",
          agentRunAnonymous: true,
        },
        () => getMcpManagerForCurrentRequest(),
      ),
    ).rejects.toThrow("Authenticated MCP principal required");

    expect(mockedMcp.buildMergedConfig).not.toHaveBeenCalled();
    expect(mockedMcp.managers).toHaveLength(0);
  });

  it("hydrates a due job from its owner and organization request context", async () => {
    const manager = await runWithRequestContext(
      { userEmail: "job-owner@example.com", orgId: "job-org" },
      () => getMcpManagerForCurrentRequest(),
    );

    expect(manager).toBe(mockedMcp.managers[0]);
    expect(mockedMcp.buildMergedConfig).toHaveBeenCalledWith({
      userEmail: "job-owner@example.com",
      orgId: "job-org",
    });
  });

  it("keeps explicit background all-mode while skipping unrequested MCP", () => {
    expect(resolveBackgroundMcpToolSelection([], true)).toBeUndefined();
    expect(resolveBackgroundMcpToolSelection([], false)).toBeNull();
    expect(
      resolveBackgroundMcpToolSelection(["mcp__mail__read"], false),
    ).toEqual(["mcp__mail__read"]);
  });

  it("rejects anonymous status requests before hydrating an MCP manager", async () => {
    authMocks.getSession.mockResolvedValue(null);
    const routes: Array<(event: any) => unknown> = [];
    const nitroApp = {
      h3: {
        use: (_path: string, handler: (event: any) => unknown) => {
          routes.push(handler);
        },
      },
    };
    const { mountMcpStatusRoute } = await import("./mcp-glue.js");
    mountMcpStatusRoute(nitroApp);

    const event = mockEvent(
      new Request("https://app.example.com/_agent-native/mcp/status"),
    );
    await routes[0]!(event);

    expect(event.res.status).toBe(401);
    expect(event.res.headers.get("cache-control")).toBe("private, no-store");
    expect(authMocks.getOrgContext).not.toHaveBeenCalled();
    expect(mockedMcp.buildMergedConfig).not.toHaveBeenCalled();
  });

  it("returns only the authenticated caller's manager status", async () => {
    authMocks.getSession.mockResolvedValue({ email: "alice@example.com" });
    authMocks.getOrgContext.mockResolvedValue({
      email: "alice@example.com",
      orgId: "acme",
      role: "member",
    });
    const routes: Array<(event: any) => unknown> = [];
    const nitroApp = {
      h3: {
        use: (_path: string, handler: (event: any) => unknown) => {
          routes.push(handler);
        },
      },
    };
    const { mountMcpStatusRoute } = await import("./mcp-glue.js");
    mountMcpStatusRoute(nitroApp);

    const event = mockEvent(
      new Request("https://app.example.com/_agent-native/mcp/status"),
    );
    await expect(routes[0]!(event)).resolves.toEqual({
      principal: "alice@example.com",
    });
    expect(mockedMcp.buildMergedConfig).toHaveBeenCalledWith({
      userEmail: "alice@example.com",
      orgId: "acme",
    });
  });

  it("evicts least-recently-used managers when the cache reaches its bound", async () => {
    const first = await getMcpManagerForPrincipal({
      userEmail: "user-0@example.com",
      orgId: null,
    });
    for (let i = 1; i < 32; i++) {
      await getMcpManagerForPrincipal({
        userEmail: `user-${i}@example.com`,
        orgId: null,
      });
    }
    await getMcpManagerForPrincipal({
      userEmail: "user-32@example.com",
      orgId: null,
    });

    expect(mockedMcp.managers).toHaveLength(33);
    expect(mockedMcp.managers[0].stop).toHaveBeenCalledOnce();
    expect(
      await getMcpManagerForPrincipal({
        userEmail: "user-0@example.com",
        orgId: null,
      }),
    ).not.toBe(first);
  });

  it("does not evict a manager while its first configuration is loading", async () => {
    let resolveConfig!: (config: unknown) => void;
    mockedMcp.buildMergedConfig.mockImplementationOnce(
      () => new Promise((resolve) => (resolveConfig = resolve)),
    );
    const pending = getMcpManagerForPrincipal({
      userEmail: "user-0@example.com",
      orgId: null,
    });
    await Promise.resolve();
    const first = mockedMcp.managers[0]!;

    for (let i = 1; i < 32; i++) {
      await getMcpManagerForPrincipal({
        userEmail: `user-${i}@example.com`,
        orgId: null,
      });
    }
    await getMcpManagerForPrincipal({
      userEmail: "user-32@example.com",
      orgId: null,
    });

    expect(first.stop).not.toHaveBeenCalled();
    resolveConfig({ source: "user-0@example.com", servers: {} });
    await pending;
    expect(
      await getMcpManagerForPrincipal({
        userEmail: "user-0@example.com",
        orgId: null,
      }),
    ).toBe(first);
  });
});

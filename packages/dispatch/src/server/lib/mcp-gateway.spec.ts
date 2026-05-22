import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverAgents: vi.fn(),
  getUserSetting: vi.fn(),
  getOrgSetting: vi.fn(),
  createEmbedSessionTicket: vi.fn(),
  buildEmbedStartPath: vi.fn((ticket: string) => {
    return `/_agent-native/embed/start?ticket=${encodeURIComponent(ticket)}`;
  }),
  managerStart: vi.fn(),
  managerStop: vi.fn(),
  managerCallTool: vi.fn(),
  managerConstructor: vi.fn(),
  signA2AToken: vi.fn(),
  getOrgA2ASecret: vi.fn(),
  getOrgDomain: vi.fn(),
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverAgents: mocks.discoverAgents,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  getOrgSetting: mocks.getOrgSetting,
  putUserSetting: vi.fn(),
  putOrgSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    createEmbedSessionTicket: mocks.createEmbedSessionTicket,
    buildEmbedStartPath: mocks.buildEmbedStartPath,
  };
});

vi.mock("@agent-native/core/a2a", () => ({
  callAgent: vi.fn(),
  signA2AToken: mocks.signA2AToken,
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgA2ASecret: mocks.getOrgA2ASecret,
  getOrgDomain: mocks.getOrgDomain,
}));

vi.mock("@agent-native/core/mcp-client", () => ({
  buildMcpToolName: (serverId: string, toolName: string) =>
    `mcp__${serverId}__${toolName}`,
  McpClientManager: class MockMcpClientManager {
    constructor(config: unknown) {
      mocks.managerConstructor(config);
    }

    start() {
      return mocks.managerStart();
    }

    stop() {
      return mocks.managerStop();
    }

    callTool(name: string, args: unknown) {
      return mocks.managerCallTool(name, args);
    }
  },
}));

import {
  createGrantedDispatchMcpEmbedSession,
  listGrantedDispatchMcpApps,
  listGrantedDispatchMcpAppOrigins,
  openGrantedDispatchMcpApp,
  resolveGrantedDispatchMcpApp,
} from "./mcp-gateway.js";
import { runWithRequestContext } from "@agent-native/core/server";

const analyticsAgent = {
  id: "analytics",
  name: "Analytics",
  description: "Dashboards and metrics",
  url: "http://localhost:8086",
  color: "#6366F1",
};

beforeEach(() => {
  mocks.discoverAgents.mockResolvedValue([analyticsAgent]);
  mocks.getUserSetting.mockResolvedValue(null);
  mocks.getOrgSetting.mockResolvedValue(null);
  mocks.createEmbedSessionTicket.mockResolvedValue({
    ticket: "ticket-123",
    ticketHash: "hash-123",
    expiresAt: 12345,
  });
  mocks.managerStart.mockResolvedValue(undefined);
  mocks.managerStop.mockResolvedValue(undefined);
  mocks.managerCallTool.mockResolvedValue({
    structuredContent: {
      startUrl: "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    },
  });
  mocks.signA2AToken.mockResolvedValue("signed-token");
  mocks.getOrgA2ASecret.mockResolvedValue(null);
  mocks.getOrgDomain.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Dispatch MCP gateway app discovery", () => {
  it("includes Dispatch itself so agents can target extension routes", async () => {
    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch", "analytics"]);
    expect(apps[0]).toMatchObject({
      id: "dispatch",
      name: "Agent-Native Dispatch",
      url: "http://localhost:8092",
      granted: true,
    });
  });

  it("honors selected app grants for the Dispatch self target", async () => {
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch"],
    });

    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch"]);
  });

  it("returns deduped origins for granted Dispatch MCP apps only", async () => {
    mocks.discoverAgents.mockResolvedValue([
      analyticsAgent,
      {
        ...analyticsAgent,
        id: "analytics-copy",
        name: "Analytics Copy",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Mail",
        url: "https://mail.agent-native.com/inbox",
        color: "#2563EB",
      },
      {
        id: "bad-url",
        name: "Bad URL",
        description: "Invalid manifest URL",
        url: "mail.agent-native.com",
        color: "#111827",
      },
      {
        id: "file-url",
        name: "File URL",
        description: "Unsupported manifest URL scheme",
        url: "file:///tmp/app",
        color: "#111827",
      },
    ]);
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch", "analytics", "mail", "bad-url", "file-url"],
    });

    const origins = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpAppOrigins(),
    );
    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(origins).toEqual([
      "http://localhost:8092",
      "http://localhost:8086",
      "https://mail.agent-native.com",
    ]);
    expect(apps.map((app) => app.id)).toEqual([
      "dispatch",
      "analytics",
      "mail",
    ]);
  });

  it("rejects malformed granted app URLs before routing MCP actions", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "bad-url",
        name: "Bad URL",
        description: "Invalid manifest URL",
        url: "mail.agent-native.com",
        color: "#111827",
      },
    ]);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () => resolveGrantedDispatchMcpApp("bad-url"),
      ),
    ).rejects.toThrow(/invalid URL/);
  });
});

describe("openGrantedDispatchMcpApp", () => {
  it("opens Dispatch extension routes through the Dispatch app id", async () => {
    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "dispatch",
          path: "/extensions/ext-1/github-stars-over-time",
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(result).toEqual({
      app: "dispatch",
      path: "/extensions/ext-1/github-stars-over-time",
      url: "http://localhost:8092/extensions/ext-1/github-stars-over-time",
      embed: true,
      chrome: "minimal",
      embedStartUrl:
        "http://localhost:8092/_agent-native/embed/start?ticket=ticket-123",
      embedTargetPath: "/extensions/ext-1/github-stars-over-time",
      embedExpiresAt: 12345,
    });
  });

  it("pre-mints cross-app embed sessions for MCP app hosts", async () => {
    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "analytics",
          path: "/dashboards?range=30d",
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "http://localhost:8086/dashboards?range=30d",
        chrome: "minimal",
      },
    );
    expect(result).toEqual({
      app: "analytics",
      path: "/dashboards?range=30d",
      url: "http://localhost:8086/dashboards?range=30d",
      embed: true,
      chrome: "minimal",
      embedStartUrl:
        "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    });
  });

  it("retries transient target MCP connection failures while pre-minting embeds", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    mocks.managerCallTool
      .mockRejectedValueOnce(
        new Error(
          'MCP server "target" is not connected: The server did not complete the Streamable HTTP MCP handshake.',
        ),
      )
      .mockResolvedValueOnce({
        structuredContent: {
          startUrl:
            "http://localhost:8086/_agent-native/embed/start?ticket=remote",
        },
      });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "analytics",
          path: "/dashboards",
          embed: true,
        }),
    );

    expect(mocks.managerConstructor).toHaveBeenCalledTimes(2);
    expect(mocks.managerStart).toHaveBeenCalledTimes(2);
    expect(mocks.managerStop).toHaveBeenCalledTimes(2);
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      app: "analytics",
      embedStartUrl:
        "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    });
    randomSpy.mockRestore();
  });

  it("returns the normal open URL when embed preminting fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.managerCallTool.mockRejectedValueOnce(
      new Error("Target app did not return an embed session."),
    );

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "analytics",
          path: "/dashboards",
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(result).toEqual({
      app: "analytics",
      path: "/dashboards",
      url: "http://localhost:8086/dashboards",
      embed: true,
      chrome: "minimal",
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("rejects Dispatch-owned extension routes on sibling apps", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          openGrantedDispatchMcpApp({
            app: "analytics",
            path: "/extensions/ext-1/github-stars-over-time",
          }),
      ),
    ).rejects.toThrow(/belongs to Dispatch/);
  });

  it("rejects traversal that normalizes into Dispatch-owned routes on sibling apps", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          openGrantedDispatchMcpApp({
            app: "analytics",
            path: "/../dispatch/extensions/ext-1",
          }),
      ),
    ).rejects.toThrow(/safe app-relative route/);
  });
});

describe("createGrantedDispatchMcpEmbedSession", () => {
  it("mints Dispatch self embeds locally instead of recursively calling Dispatch MCP", async () => {
    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "dispatch",
          path: "/extensions/ext-1/github-stars-over-time",
          chrome: "minimal",
        }),
    );

    expect(mocks.createEmbedSessionTicket).toHaveBeenCalledWith({
      ownerEmail: "owner@example.test",
      orgId: undefined,
      targetPath: "/extensions/ext-1/github-stars-over-time",
      scope: "minimal",
    });
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
    expect(result).toEqual({
      app: "dispatch",
      startUrl:
        "http://localhost:8092/_agent-native/embed/start?ticket=ticket-123",
      targetPath: "/extensions/ext-1/github-stars-over-time",
      expiresAt: 12345,
    });
  });

  it("rejects traversal into Dispatch-owned embed routes on sibling apps", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/../dispatch/extensions/ext-1",
          }),
      ),
    ).rejects.toThrow(/safe app-relative route/);
  });

  it("routes same-origin mounted app embed URLs to the mounted app", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        ...analyticsAgent,
        url: "http://localhost:8092/analytics",
      },
    ]);

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          url: "http://localhost:8092/analytics/dashboards?range=30d",
        }),
    );

    expect(mocks.createEmbedSessionTicket).not.toHaveBeenCalled();
    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          url: "http://localhost:8092/analytics/_agent-native/mcp",
        }),
      },
    });
    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "http://localhost:8092/analytics/dashboards?range=30d",
        chrome: "full",
      },
    );
    expect(result).toEqual({
      app: "analytics",
      startUrl: "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    });
  });

  it("skips malformed granted app URLs when matching embed URLs", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "bad-url",
        name: "Bad URL",
        description: "Invalid manifest URL",
        url: "mail.agent-native.com",
        color: "#111827",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Mail",
        url: "https://mail.agent-native.com",
        color: "#2563EB",
      },
    ]);

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          url: "https://mail.agent-native.com/inbox",
        }),
    );

    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          url: "https://mail.agent-native.com/_agent-native/mcp",
        }),
      },
    });
    expect(result).toEqual({
      app: "mail",
      startUrl: "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    });
  });

  it("uses the org A2A secret when minting cross-app MCP embed tokens", async () => {
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");

    await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/dashboards",
        }),
    );

    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      "builder.io",
      "org-specific-secret",
      {
        expiresIn: "5m",
        preferGlobalSecret: false,
      },
    );
  });

  it("falls back to the shared A2A secret when no org secret is available", async () => {
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue(null);

    await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/dashboards",
        }),
    );

    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      "builder.io",
      undefined,
      {
        expiresIn: "5m",
        preferGlobalSecret: true,
      },
    );
  });

  it("falls back to the shared A2A secret when org signing inputs are incomplete", async () => {
    mocks.getOrgDomain.mockResolvedValue(null);
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");

    await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/dashboards",
        }),
    );

    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      undefined,
      undefined,
      {
        expiresIn: "5m",
        preferGlobalSecret: true,
      },
    );
  });

  it("does not retry permanent target MCP errors", async () => {
    mocks.managerCallTool.mockRejectedValueOnce(
      new Error(
        'MCP server "target" is not connected: The MCP server rejected the request.',
      ),
    );

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/rejected the request/);
    expect(mocks.managerConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);
  });

  it("does not let stop failures mask target MCP errors", async () => {
    mocks.managerCallTool.mockRejectedValueOnce(
      new Error("Target app returned a permanent auth error."),
    );
    mocks.managerStop.mockRejectedValueOnce(new Error("stop failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/permanent auth error/);
    expect(warnSpy).toHaveBeenCalledWith(
      "[dispatch] Failed to stop target MCP client:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("surfaces target MCP embed-session errors", async () => {
    mocks.managerCallTool.mockResolvedValueOnce({
      isError: true,
      content: [
        {
          type: "text",
          text: "Error: create_embed_session requires an authenticated MCP caller.",
        },
      ],
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/authenticated MCP caller/);
  });
});

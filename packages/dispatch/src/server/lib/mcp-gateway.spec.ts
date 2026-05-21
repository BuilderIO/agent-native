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
  openGrantedDispatchMcpApp,
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
    });
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
});

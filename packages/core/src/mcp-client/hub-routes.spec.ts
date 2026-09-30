import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsMock = vi.hoisted(() => ({
  getOrgSetting: vi.fn(),
}));
const principalMock = vi.hoisted(() => ({
  resolveMcpPrincipalForEvent: vi.fn(),
}));

vi.mock("../settings/org-settings.js", () => settingsMock);
vi.mock("./principal.js", () => principalMock);
vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: (app: { h3: unknown }) => app.h3,
}));

const { listHubServers, mountMcpHubRoutes } = await import("./hub-routes.js");
const { mockEvent } = await import("h3");

beforeEach(() => {
  settingsMock.getOrgSetting.mockReset();
  principalMock.resolveMcpPrincipalForEvent.mockReset();
  vi.stubEnv("AGENT_NATIVE_MCP_HUB_TOKEN", "hub-secret");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("listHubServers", () => {
  it("loads only the requested organization's remote MCP setting", async () => {
    settingsMock.getOrgSetting.mockResolvedValue({
      servers: [
        {
          id: "drive",
          name: "Drive",
          url: "https://mcp.example.test/mcp",
        },
      ],
    });

    await expect(listHubServers("acme")).resolves.toEqual([
      {
        id: "acme-Drive",
        orgId: "acme",
        name: "Drive",
        url: "https://mcp.example.test/mcp",
        headers: undefined,
        description: undefined,
      },
    ]);
    expect(settingsMock.getOrgSetting).toHaveBeenCalledOnce();
    expect(settingsMock.getOrgSetting).toHaveBeenCalledWith(
      "acme",
      "mcp-servers-remote",
    );
  });

  it("preserves settings read failures", async () => {
    const error = new Error("database unavailable");
    settingsMock.getOrgSetting.mockRejectedValue(error);

    await expect(listHubServers("acme")).rejects.toBe(error);
  });

  it("rejects a browser request for an organization outside the caller scope", async () => {
    principalMock.resolveMcpPrincipalForEvent.mockResolvedValue({
      userEmail: "alice@example.com",
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
    mountMcpHubRoutes(nitroApp);

    const event = mockEvent(
      new Request(
        "https://hub.example/_agent-native/mcp/hub/servers?orgId=beta",
        { headers: { authorization: "Bearer hub-secret" } },
      ),
    );
    await routes[0]!(event);

    expect(event.res.status).toBe(403);
    expect(settingsMock.getOrgSetting).not.toHaveBeenCalled();
  });

  it("serves only the ambient org to an authorized service token", async () => {
    principalMock.resolveMcpPrincipalForEvent.mockResolvedValue(null);
    settingsMock.getOrgSetting.mockResolvedValue({ servers: [] });
    vi.stubEnv("AGENT_ORG_ID", "service-org");
    const routes: Array<(event: any) => unknown> = [];
    const nitroApp = {
      h3: {
        use: (_path: string, handler: (event: any) => unknown) => {
          routes.push(handler);
        },
      },
    };
    mountMcpHubRoutes(nitroApp);

    const event = mockEvent(
      new Request("https://hub.example/_agent-native/mcp/hub/servers", {
        headers: { authorization: "Bearer hub-secret" },
      }),
    );
    const response = await routes[0]!(event);

    expect(response).toMatchObject({ servers: [] });
    expect(event.res.headers.get("cache-control")).toBe("no-store");
    expect(settingsMock.getOrgSetting).toHaveBeenCalledWith(
      "service-org",
      "mcp-servers-remote",
    );
  });

  it("rejects a service token without an ambient org before reading settings", async () => {
    principalMock.resolveMcpPrincipalForEvent.mockResolvedValue(null);
    const routes: Array<(event: any) => unknown> = [];
    const nitroApp = {
      h3: {
        use: (_path: string, handler: (event: any) => unknown) => {
          routes.push(handler);
        },
      },
    };
    mountMcpHubRoutes(nitroApp);

    const event = mockEvent(
      new Request("https://hub.example/_agent-native/mcp/hub/servers", {
        headers: { authorization: "Bearer hub-secret" },
      }),
    );
    await routes[0]!(event);

    expect(event.res.status).toBe(401);
    expect(settingsMock.getOrgSetting).not.toHaveBeenCalled();
  });
});

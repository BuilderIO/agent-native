import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listGrantedDispatchMcpAppOrigins: vi.fn(),
  openGrantedDispatchMcpApp: vi.fn(),
  routeAppIntentRun: vi.fn(),
}));

vi.mock("./route-app-intent.js", () => ({
  default: { run: mocks.routeAppIntentRun },
}));

vi.mock("../server/lib/mcp-gateway.js", () => ({
  listGrantedDispatchMcpAppOrigins: mocks.listGrantedDispatchMcpAppOrigins,
  openGrantedDispatchMcpApp: mocks.openGrantedDispatchMcpApp,
}));

import openAppAction from "./open_app.js";

describe("open_app MCP App metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tells the model to open the pane for show, draft, chart, and calendar asks", () => {
    for (const ask of [
      "show",
      "open",
      "draft",
      "chart",
      "calendar",
      "dashboard",
    ]) {
      expect(openAppAction.tool.description).toContain(ask);
    }
  });

  it("uses exact granted app origins instead of broad HTTPS CSP", async () => {
    mocks.listGrantedDispatchMcpAppOrigins.mockResolvedValue([
      "https://dispatch.agent-native.com",
      "https://mail.agent-native.com",
      "https://calendar.agent-native.com",
    ]);

    const cspBuilder = openAppAction.mcpApp?.resource.csp;
    expect(typeof cspBuilder).toBe("function");

    const csp = await (cspBuilder as any)({
      actionName: "open_app",
      appId: "dispatch",
      requestOrigin: "https://dispatch.agent-native.com",
    });

    expect(csp.connectDomains).toEqual([
      "https://esm.sh",
      "$requestOrigin",
      "https://mail.agent-native.com",
      "https://calendar.agent-native.com",
      "http://localhost:*",
      "http://127.0.0.1:*",
    ]);
    expect(csp.resourceDomains).toEqual(csp.connectDomains);
    expect(csp.frameDomains).toEqual([
      "$requestOrigin",
      "https://mail.agent-native.com",
      "https://calendar.agent-native.com",
      "http://localhost:*",
      "http://127.0.0.1:*",
    ]);
    expect(csp.baseUriDomains).toEqual(csp.frameDomains);
    expect(JSON.stringify(csp)).not.toContain('"https:"');
  });

  it("keeps exact granted origins when request origin is unavailable", async () => {
    mocks.listGrantedDispatchMcpAppOrigins.mockResolvedValue([
      "https://mail.agent-native.com",
      "https://calendar.agent-native.com",
    ]);

    const cspBuilder = openAppAction.mcpApp?.resource.csp;
    const csp = await (cspBuilder as any)({
      actionName: "open_app",
      appId: "dispatch",
    });

    expect(csp.frameDomains).toEqual([
      "$requestOrigin",
      "https://mail.agent-native.com",
      "https://calendar.agent-native.com",
      "http://localhost:*",
      "http://127.0.0.1:*",
    ]);
  });

  it("promotes embed and chrome from params for hosts that nest open options", async () => {
    mocks.openGrantedDispatchMcpApp.mockResolvedValue({
      app: "mail",
      view: "inbox",
      url: "https://mail.agent-native.com/inbox",
      embed: true,
      chrome: "minimal",
      embedStartUrl:
        "https://mail.agent-native.com/_agent-native/embed/start?ticket=test",
    });

    await openAppAction.run({
      app: "mail",
      view: "inbox",
      params: {
        embed: true,
        chrome: "minimal",
        threadId: "abc",
      },
    });

    expect(mocks.openGrantedDispatchMcpApp).toHaveBeenCalledWith({
      app: "mail",
      view: "inbox",
      params: { threadId: "abc" },
      embed: true,
      chrome: "minimal",
    });
  });

  it.each([
    ["an MCP host", "mcp", undefined, true],
    ["an MCP host that opts out", "mcp", false, false],
    ["the app's own agent", "tool", undefined, undefined],
  ] as const)(
    "asks the target app for a session when %s opens it",
    async (_label, caller, embed, expected) => {
      mocks.openGrantedDispatchMcpApp.mockReset();
      mocks.openGrantedDispatchMcpApp.mockResolvedValue({
        app: "mail",
        view: "inbox",
        url: "https://mail.agent-native.com/inbox",
      });

      await openAppAction.run(
        {
          app: "mail",
          view: "inbox",
          ...(embed === undefined ? {} : { embed }),
        },
        { caller } as any,
      );

      const [input, options] = mocks.openGrantedDispatchMcpApp.mock.calls[0];
      expect(input.embed).toBe(expected);
      expect(options).toEqual(
        caller === "tool" ? { prefetchEmbed: true } : undefined,
      );
    },
  );

  it("tells the MCP server an MCP host opted out of the panel", async () => {
    mocks.openGrantedDispatchMcpApp.mockReset();
    mocks.openGrantedDispatchMcpApp.mockResolvedValue({
      app: "mail",
      view: "inbox",
      url: "https://mail.agent-native.com/inbox",
    });

    await expect(
      openAppAction.run({ app: "mail", view: "inbox", embed: false }, {
        caller: "mcp",
      } as any),
    ).resolves.toMatchObject({ app: "mail", embed: false });
  });

  describe("intent", () => {
    const opened = {
      app: "mail",
      url: "https://mail.agent-native.com/",
    };

    beforeEach(() => {
      mocks.openGrantedDispatchMcpApp.mockReset();
      mocks.openGrantedDispatchMcpApp.mockResolvedValue(opened);
      mocks.routeAppIntentRun.mockReset();
    });

    it("picks the app from the intent when app is not given", async () => {
      mocks.routeAppIntentRun.mockResolvedValue({ status: "ok", app: "mail" });

      await openAppAction.run({ intent: "my unread email from Dana" });

      expect(mocks.routeAppIntentRun).toHaveBeenCalledWith(
        { text: "my unread email from Dana" },
        undefined,
      );
      const input = mocks.openGrantedDispatchMcpApp.mock.calls[0]?.[0];
      expect(input).toEqual({ app: "mail" });
    });

    it("lets an explicit app win over the intent", async () => {
      await openAppAction.run({
        app: "calendar",
        view: "week",
        intent: "my unread email",
      });

      expect(mocks.routeAppIntentRun).not.toHaveBeenCalled();
      const input = mocks.openGrantedDispatchMcpApp.mock.calls[0]?.[0];
      expect(input).toEqual({ app: "calendar", view: "week" });
    });

    it.each([
      [{ status: "failed", reason: "no_granted_apps" }, /no_granted_apps/],
      [{ status: "ok", app: "none" }, /needs no app/],
    ])(
      "does not open anything when routing gives %j",
      async (routed, error) => {
        mocks.routeAppIntentRun.mockResolvedValue(routed);

        await expect(openAppAction.run({ intent: "hello" })).rejects.toThrow(
          error,
        );
        expect(mocks.openGrantedDispatchMcpApp).not.toHaveBeenCalled();
      },
    );

    it("needs an app or an intent", async () => {
      await expect(openAppAction.run({})).rejects.toThrow(/app, or an intent/);
    });
  });

  it("is marked as opening another app's embed", () => {
    expect(openAppAction.opensAnotherAppEmbed).toBe(true);
  });
});

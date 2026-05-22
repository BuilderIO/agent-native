import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listGrantedDispatchMcpAppOrigins: vi.fn(),
  openGrantedDispatchMcpApp: vi.fn(),
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
});

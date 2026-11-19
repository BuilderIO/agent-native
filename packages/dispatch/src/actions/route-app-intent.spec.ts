import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  getRequestUserEmail: vi.fn(),
  listGrantedDispatchMcpApps: vi.fn(),
}));

vi.mock("@agent-native/core/decisions", () => ({ decide: mocks.decide }));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../server/lib/mcp-gateway.js", () => ({
  listGrantedDispatchMcpApps: mocks.listGrantedDispatchMcpApps,
}));

import routeAppIntent from "./route-app-intent.js";

const run = (args: Record<string, unknown>) =>
  routeAppIntent.run(args as never, { caller: "http" } as never);

describe("route-app-intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.listGrantedDispatchMcpApps.mockResolvedValue([
      { id: "calendar", name: "Calendar", description: "" },
      { id: "mail", name: "Mail", description: "Email inbox" },
    ]);
  });

  it("is reachable by desktop MCP clients but hidden from the in-app agent", () => {
    expect(routeAppIntent.agentTool).toBe(false);
    expect(routeAppIntent.mcpTool).toBe(true);
  });

  it("asks one choice question built from the granted apps", async () => {
    mocks.decide.mockResolvedValue({
      status: "ok",
      provider: "jev",
      model: "jev-1",
      cached: true,
      answers: { app: { type: "choice", name: "app", choice: "calendar" } },
    });

    const result = await run({
      text: "move it to 4pm",
      openApp: "calendar",
      previousTurn: "added [demo test] tomorrow at 2pm",
    });

    expect(result).toMatchObject({
      status: "ok",
      app: "calendar",
      provider: "jev",
      model: "jev-1",
      cached: true,
    });
    const call = mocks.decide.mock.calls[0][0];
    expect(call.ownerEmail).toBe("owner@example.com");
    expect(call.options.cacheKey).toBeTruthy();
    expect(call.questions).toHaveLength(1);
    expect(call.questions[0].choices.map((c: any) => c.value)).toEqual([
      "calendar",
      "mail",
      "none",
    ]);
    expect(call.input).toEqual([
      { type: "text", text: "Request: move it to 4pm" },
      { type: "text", text: "App currently on screen: calendar" },
      {
        type: "json",
        value: { previousTurn: "added [demo test] tomorrow at 2pm" },
      },
    ]);
  });

  it("returns none for chat-only asks", async () => {
    mocks.decide.mockResolvedValue({
      status: "ok",
      provider: "openai",
      model: "m",
      answers: { app: { type: "choice", name: "app", choice: "none" } },
    });

    expect(await run({ text: "tell me a joke" })).toMatchObject({
      status: "ok",
      app: "none",
      cached: false,
    });
  });

  it("passes not_configured and failures through without an app", async () => {
    mocks.decide.mockResolvedValueOnce({
      status: "not_configured",
      reason: "missing_credentials",
      providers: [],
    });
    const notConfigured = await run({ text: "my inbox" });
    expect(notConfigured).toMatchObject({
      status: "not_configured",
      reason: "missing_credentials",
    });
    expect(notConfigured).not.toHaveProperty("app");

    mocks.decide.mockResolvedValueOnce({ status: "failed", reason: "timeout" });
    const failed = await run({ text: "my inbox" });
    expect(failed).toMatchObject({ status: "failed", reason: "timeout" });
    expect(failed).not.toHaveProperty("app");
  });

  it("refuses an answer outside the granted choices", async () => {
    mocks.decide.mockResolvedValue({
      status: "ok",
      provider: "jev",
      model: "jev-1",
      answers: { app: { type: "choice", name: "app", choice: "crm" } },
    });

    const result = await run({ text: "my deals" });
    expect(result).toMatchObject({
      status: "failed",
      reason: "invalid_response",
    });
    expect(result).not.toHaveProperty("app");
  });

  it("fails without a signed-in requester", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    expect(await run({ text: "my inbox" })).toEqual({
      status: "failed",
      reason: "no_authenticated_user",
    });
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});

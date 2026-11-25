import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  getRequestUserEmail: vi.fn(),
  listGrantedDispatchMcpApps: vi.fn(),
  listPointerRows: vi.fn(),
}));

vi.mock("@agent-native/core/decisions", () => ({ decide: mocks.decide }));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  getRequestOrgId: () => "org_1",
}));
vi.mock("@agent-native/core/resources/store", () => ({
  resourceListContentByOwnersAndPrefixes: mocks.listPointerRows,
  resourcePut: vi.fn(),
  sharedResourceOwner: (orgId: string) => `org:${orgId}`,
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
    mocks.listPointerRows.mockResolvedValue([]);
    mocks.listGrantedDispatchMcpApps.mockResolvedValue([
      { id: "calendar", name: "Calendar", description: "" },
      { id: "mail", name: "Mail", description: "Email inbox" },
    ]);
  });

  it.each([
    ["show me GitHub messages from actual people", "mail"],
    ["show emails about GitHub issues", "mail"],
    ["open my GitHub inbox", "mail"],
    ["find messages from people", "mail"],
    ["show my GitHub issues", "tasks"],
    ["open GitHub pull requests", "tasks"],
    ["list GitHub PRs assigned to me", "tasks"],
  ])(
    "routes %s to %s despite a competing service pointer",
    async (text, app) => {
      mocks.listGrantedDispatchMcpApps.mockResolvedValue([
        { id: "mail", name: "Mail", description: "Email inbox" },
        { id: "tasks", name: "Tasks", description: "GitHub integration" },
      ]);
      mocks.listPointerRows.mockResolvedValue([
        {
          id: "p1",
          owner: "owner@example.com",
          path: "pointers/github.json",
          content: JSON.stringify({ alias: "GitHub", appId: "tasks" }),
        },
      ]);
      mocks.decide.mockResolvedValue({
        status: "ok",
        provider: "test",
        model: "test",
        answers: {
          app: { type: "choice", choice: app === "mail" ? "tasks" : "mail" },
        },
      });
      expect(await run({ text })).toMatchObject({ status: "ok", app });
    },
  );

  it("falls back to classification when the mail app is not granted", async () => {
    mocks.listGrantedDispatchMcpApps.mockResolvedValue([
      { id: "tasks", name: "Tasks", description: "GitHub integration" },
    ]);
    mocks.decide.mockResolvedValue({
      status: "ok",
      provider: "test",
      model: "test",
      answers: { app: { type: "choice", choice: "none" } },
    });
    expect(await run({ text: "show my inbox" })).toMatchObject({
      status: "ok",
      app: "none",
    });
    expect(mocks.decide).toHaveBeenCalledOnce();
  });

  it("recognizes an explicit registered app choice without classifying it", async () => {
    expect(await run({ text: "Open Mail." })).toMatchObject({
      status: "ok",
      app: "mail",
      confidence: 1,
      explicit: true,
      screen: "home",
    });
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("keeps explicit installation IDs ahead of competing workspace aliases", async () => {
    mocks.listGrantedDispatchMcpApps.mockResolvedValue([
      {
        id: "fleet-2",
        name: "Fleet",
        description: "",
        source: "builtin",
      },
      {
        id: "workspace/fleet",
        name: "Fleet",
        description: "",
        aliases: ["fleet-2"],
        source: "workspace",
      },
    ]);
    await expect(run({ text: "Open Fleet-2" })).resolves.toMatchObject({
      app: "fleet-2",
      explicit: true,
    });
    await expect(run({ text: "Open Fleet" })).resolves.toMatchObject({
      app: "workspace/fleet",
      explicit: true,
    });
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("includes the active route, selection, and granted installation manifests", async () => {
    mocks.listGrantedDispatchMcpApps.mockResolvedValue([
      {
        id: "workspace/mail",
        name: "Mail",
        description: "Email",
        aliases: ["Inbox"],
      },
    ]);
    mocks.decide.mockResolvedValue({
      status: "ok",
      provider: "test",
      model: "test",
      answers: {
        app: { type: "choice", choice: "workspace/mail", confidence: 0.88 },
      },
    });
    await run({
      text: "Summarize this",
      openApp: "workspace/mail",
      openPath: "/threads/2?code=fixture#state=fixture",
      selection: "Selected message",
    });
    expect(mocks.decide.mock.lastCall?.[0].input).toEqual(
      expect.arrayContaining([
        {
          type: "json",
          value: {
            connectedWorkspaceApps: [
              {
                id: "workspace/mail",
                name: "Mail",
                description: "Email",
                aliases: ["Inbox"],
              },
            ],
          },
        },
        {
          type: "json",
          value: { openPath: "/threads/2", selection: "Selected message" },
        },
      ]),
    );
  });

  it("opens a saved pointer's object instead of the Tasks default", async () => {
    mocks.listGrantedDispatchMcpApps.mockResolvedValue([
      { id: "tasks", name: "Tasks", description: "To-dos" },
      { id: "content", name: "Content", description: "Docs" },
    ]);
    mocks.listPointerRows.mockResolvedValue([
      {
        id: "p1",
        owner: "owner@example.com",
        path: "pointers/todo-list.json",
        content: JSON.stringify({
          alias: "todo list",
          appId: "content",
          url: "https://example.com/content/page/abc",
        }),
      },
    ]);
    mocks.decide.mockResolvedValue({
      status: "ok",
      provider: "jev",
      model: "jev-1",
      cached: false,
      answers: { app: { type: "choice", name: "app", choice: "tasks" } },
    });

    const result = await run({ text: "whats on my todo list" });

    expect(result).toMatchObject({
      status: "ok",
      app: "content",
      pointer: true,
      url: "https://example.com/content/page/abc",
    });
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.listPointerRows).toHaveBeenCalledTimes(1);
  });

  it("ignores pointers to apps that are not granted and feeds the rest to decide", async () => {
    mocks.listPointerRows.mockResolvedValue([
      {
        id: "p1",
        owner: "owner@example.com",
        path: "pointers/todo-list.json",
        content: JSON.stringify({
          alias: "todo list",
          appId: "gone",
          url: "u",
        }),
      },
      {
        id: "p2",
        owner: "owner@example.com",
        path: "pointers/standup-notes.json",
        content: JSON.stringify({
          alias: "standup notes",
          appId: "mail",
          url: "u",
        }),
      },
    ]);
    mocks.decide.mockResolvedValue({
      status: "ok",
      provider: "jev",
      model: "jev-1",
      cached: false,
      answers: {
        app: { type: "choice", name: "app", choice: "mail", confidence: 0.91 },
      },
    });

    const result = await run({ text: "whats on my todo list" });

    expect(result).toMatchObject({
      status: "ok",
      app: "mail",
      confidence: 0.91,
    });
    expect(result).not.toHaveProperty("pointer");
    const parts = mocks.decide.mock.calls[0][0].input;
    expect(parts).toContainEqual({
      type: "json",
      value: { savedPointers: [{ alias: "standup notes", appId: "mail" }] },
    });
    expect(mocks.decide.mock.calls[0][0].options.cacheKey).toMatch(/\.v5$/);
  });

  it.each(["mail", "tasks"])(
    "lets classification resolve a cross-app pointer to %s",
    async (choice) => {
      mocks.listGrantedDispatchMcpApps.mockResolvedValue([
        { id: "mail", name: "Mail", description: "Email inbox" },
        { id: "tasks", name: "Tasks", description: "Pull requests" },
      ]);
      mocks.listPointerRows.mockResolvedValue([
        {
          id: "p1",
          owner: "owner@example.com",
          path: "pointers/github.json",
          content: JSON.stringify({
            alias: "GitHub",
            appId: "tasks",
            url: "https://example.com/reviews",
          }),
        },
      ]);
      mocks.decide.mockResolvedValue({
        status: "ok",
        provider: "test",
        model: "test",
        cached: false,
        answers: { app: { type: "choice", name: "app", choice } },
      });

      const result = await run({
        text:
          choice === "mail"
            ? "GitHub notifications from people"
            : "open my GitHub reviews",
        openApp: "mail",
      });
      expect(result).toMatchObject({ status: "ok", app: choice });
      expect("pointer" in result && result.pointer === true).toBe(
        choice === "tasks",
      );
      expect("url" in result ? result.url : undefined).toBe(
        choice === "tasks" ? "https://example.com/reviews" : undefined,
      );
      expect(mocks.decide).toHaveBeenCalledOnce();
    },
  );

  it("lets the request select another app despite a pointer in the current app", async () => {
    mocks.listGrantedDispatchMcpApps.mockResolvedValue([
      { id: "mail", name: "Mail", description: "Email inbox" },
      { id: "tasks", name: "Tasks", description: "Pull requests" },
    ]);
    mocks.listPointerRows.mockResolvedValue([
      {
        id: "p1",
        owner: "owner@example.com",
        path: "pointers/github.json",
        content: JSON.stringify({
          alias: "GitHub",
          appId: "mail",
          url: "https://example.com/mail",
        }),
      },
    ]);
    mocks.decide.mockResolvedValue({
      status: "ok",
      provider: "test",
      model: "test",
      cached: false,
      answers: { app: { type: "choice", name: "app", choice: "tasks" } },
    });
    const result = await run({
      text: "show my GitHub pull requests",
      openApp: "mail",
    });
    expect(result).toMatchObject({ status: "ok", app: "tasks" });
    expect(result).not.toHaveProperty("pointer");
    expect(mocks.decide).not.toHaveBeenCalled();
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
      {
        type: "json",
        value: {
          connectedWorkspaceApps: [
            { id: "calendar", name: "Calendar", description: "" },
            { id: "mail", name: "Mail", description: "Email inbox" },
          ],
        },
      },
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
    const notConfigured = await run({ text: "my schedule" });
    expect(notConfigured).toMatchObject({
      status: "not_configured",
      reason: "missing_credentials",
    });
    expect(notConfigured).not.toHaveProperty("app");

    mocks.decide.mockResolvedValueOnce({ status: "failed", reason: "timeout" });
    const failed = await run({ text: "my schedule" });
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

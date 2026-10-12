import { createApp, mockEvent } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const booted = vi.hoisted(() => ({
  handlerOptions: [] as Array<Record<string, any>>,
  initPromises: [] as Promise<void>[],
  a2aConfig: undefined as
    | {
        handler: (
          message: unknown,
          context: unknown,
        ) => AsyncGenerator<unknown, void>;
      }
    | undefined,
  mcpConfig: undefined as
    | { askAgent: (message: string) => Promise<unknown> }
    | undefined,
  delegatedAdditions: [] as Array<{ surface: string; names: string[] }>,
}));

// A2A and ask_app go on to run the model after resolving app actions, so stop
// them right after the merge and record which app names survived it.
vi.mock("./agent-chat/additional-actions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-chat/additional-actions.js")>();
  return {
    ...actual,
    resolveAppAdditionalActions: async (
      ...args: Parameters<typeof actual.resolveAppAdditionalActions>
    ) => {
      const added = await actual.resolveAppAdditionalActions(...args);
      if (args[1].surface === "chat") return added;
      booted.delegatedAdditions.push({
        surface: args[1].surface,
        names: Object.keys(added),
      });
      throw new Error("app actions resolved");
    },
  };
});

vi.mock("../agent/production-agent.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../agent/production-agent.js")>();
  return {
    ...actual,
    createProductionAgentHandler: (options: any) => {
      booted.handlerOptions.push(options);
      return actual.createProductionAgentHandler(options);
    },
  };
});

vi.mock("./framework-request-handler.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./framework-request-handler.js")>()),
  awaitBootstrap: () => Promise.resolve(),
  getH3App: (nitroApp: any) => nitroApp.h3App,
  markDefaultPluginProvided: vi.fn(),
  trackPluginInit: (_nitroApp: any, promise: Promise<void>) => {
    booted.initPromises.push(promise);
  },
}));

vi.mock("../a2a/server.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../a2a/server.js")>()),
  mountA2A: (_app: unknown, config: any) => {
    booted.a2aConfig = config;
  },
}));

vi.mock("../mcp/server.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp/server.js")>()),
  mountMCP: (_nitroApp: unknown, config: any) => {
    booted.mcpConfig = config;
  },
}));

vi.mock("../agent/run-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/run-store.js")>()),
  listUnclaimedBackgroundRunRows: vi.fn(async () => []),
  reapAllStaleRuns: vi.fn(async () => ({
    scanned: 0,
    reaped: 0,
    failed: 0,
    truncated: false,
  })),
}));

vi.mock("../mcp-client/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp-client/index.js")>()),
  buildMergedConfig: vi.fn(async () => null),
  startMcpConfigRefresh: () => () => {},
}));

vi.mock("../jobs/scheduler.js", () => ({
  processRecurringJobs: vi.fn(async () => {}),
}));

vi.mock("../triggers/dispatcher.js", () => ({
  initTriggerDispatcher: vi.fn(async () => {}),
}));

vi.mock("../chat-threads/migrations.js", () => ({
  runChatThreadDataMigrations: vi.fn(async () => {}),
}));

vi.mock("./social-og-image.js", () => ({
  createAgentNativeOgImageHandler: () => () => new Response(),
}));

import type { ActionEntry } from "../agent/production-agent.js";
import { createAgentChatPlugin } from "./agent-chat-plugin.js";
import type { AgentChatPluginOptions } from "./agent-chat/plugin-options.js";
import { runWithRequestContext } from "./request-context.js";

function entry(description: string): ActionEntry {
  return {
    tool: {
      description,
      parameters: { type: "object", properties: {} },
    },
    run: async () => description,
  };
}

const closers: Array<() => void | Promise<void>> = [];

async function boot(
  resolveAdditionalActions: AgentChatPluginOptions["resolveAdditionalActions"],
  { mcpEnabled = false }: { mcpEnabled?: boolean } = {},
): Promise<void> {
  const nitroApp = {
    h3App: createApp(),
    hooks: {
      hook(name: string, callback: () => void | Promise<void>) {
        if (name === "close") closers.push(callback);
      },
    },
  };
  createAgentChatPlugin({
    actions: () => ({ "list-decks": entry("template list-decks") }),
    a2aAgentDelegation: false,
    frameworkTools: "minimal",
    leanPrompt: true,
    mcp: { enabled: mcpEnabled },
    resolveAdditionalActions,
  })(nitroApp);
  await booted.initPromises.at(-1);
}

describe("resolveAdditionalActions through the agent chat plugin", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    booted.handlerOptions.length = 0;
    booted.a2aConfig = undefined;
    booted.mcpConfig = undefined;
    booted.delegatedAdditions.length = 0;
  });

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("adds the app's chat actions in production and dev without replacing registered names", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = { path: "/_agent-native/agent-chat" };
    const appResolver = vi.fn(async () => ({
      "list-decks": entry("app list-decks"),
      "user-registered-tool": entry("user tool"),
    }));
    await boot(appResolver);

    const chatHandlers = booted.handlerOptions.filter(
      (options) => options.resolveAdditionalActions,
    );
    expect(chatHandlers).toHaveLength(2);
    for (const options of chatHandlers) {
      const added: Record<string, ActionEntry> =
        await options.resolveAdditionalActions({
          event,
          ownerEmail: "alice@example.com",
          orgId: "acme",
        });
      expect(added["user-registered-tool"]?.tool.description).toBe("user tool");
      expect(added["list-decks"]).toBeUndefined();
    }
    expect(appResolver).toHaveBeenCalledTimes(2);
    expect(appResolver).toHaveBeenCalledWith({
      surface: "chat",
      event,
      ownerEmail: "alice@example.com",
      orgId: "acme",
    });
  });

  it("ignores framework names that lean mode leaves out of the chat registry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await boot(async () => ({
      "agent-teams": entry("app agent-teams"),
      "user-registered-tool": entry("user tool"),
    }));

    const chatHandlers = booted.handlerOptions.filter(
      (options) => options.resolveAdditionalActions,
    );
    expect(chatHandlers).toHaveLength(2);
    for (const options of chatHandlers) {
      expect(options.actions["agent-teams"]).toBeUndefined();
      const added: Record<string, ActionEntry> =
        await options.resolveAdditionalActions({
          event: { path: "/_agent-native/agent-chat" },
          ownerEmail: "alice@example.com",
          orgId: "acme",
        });
      expect(added["user-registered-tool"]?.tool.description).toBe("user tool");
      expect(added["agent-teams"]).toBeUndefined();
    }
  });

  it("asks the app for A2A actions with the delegated caller's identity", async () => {
    const seen: unknown[] = [];
    await boot(async (details) => {
      seen.push(details);
      throw new Error("app resolver reached");
    });

    const event = mockEvent(
      new Request("http://localhost/_agent-native/a2a", { method: "POST" }),
    );
    const failure = await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "acme" },
      () =>
        booted
          .a2aConfig!.handler(
            { role: "user", parts: [{ type: "text", text: "list my decks" }] },
            {
              taskId: "task-additional-actions",
              metadata: {},
              event,
              writeArtifact: () => "",
            },
          )
          .next()
          .then(
            () => null,
            (error: Error) => error,
          ),
    );

    expect(failure?.message).toBe("app resolver reached");
    expect(seen).toEqual([
      {
        surface: "a2a",
        event,
        ownerEmail: "alice@example.com",
        orgId: "acme",
      },
    ]);
  });

  it("asks the app for ask_app actions without an H3 event", async () => {
    const seen: unknown[] = [];
    await boot(
      async (details) => {
        seen.push(details);
        throw new Error("app resolver reached");
      },
      { mcpEnabled: true },
    );

    const failure = await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "acme" },
      () =>
        booted.mcpConfig!.askAgent("list my decks").then(
          () => null,
          (error: Error) => error,
        ),
    );

    expect(failure?.message).toBe("app resolver reached");
    expect(seen).toEqual([
      {
        surface: "mcp",
        event: undefined,
        ownerEmail: "alice@example.com",
        orgId: "acme",
      },
    ]);
  });

  it("ignores framework names that the A2A and ask_app registries leave out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await boot(
      async () => ({
        "agent-teams": entry("app agent-teams"),
        "user-registered-tool": entry("user tool"),
      }),
      { mcpEnabled: true },
    );

    const failures = await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "acme" },
      async () => [
        await booted
          .a2aConfig!.handler(
            { role: "user", parts: [{ type: "text", text: "list my decks" }] },
            {
              taskId: "task-delegated-reserved-names",
              metadata: {},
              event: mockEvent(
                new Request("http://localhost/_agent-native/a2a", {
                  method: "POST",
                }),
              ),
              writeArtifact: () => "",
            },
          )
          .next()
          .then(
            () => null,
            (error: Error) => error.message,
          ),
        await booted.mcpConfig!.askAgent("list my decks").then(
          () => null,
          (error: Error) => error.message,
        ),
      ],
    );

    expect(failures).toEqual(["app actions resolved", "app actions resolved"]);
    expect(booted.delegatedAdditions).toEqual([
      { surface: "a2a", names: ["user-registered-tool"] },
      { surface: "mcp", names: ["user-registered-tool"] },
    ]);
  });
});

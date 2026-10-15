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
  delegatedAdditions: [] as Array<{
    surface: string;
    names: string[];
    entries: Record<string, any>;
  }>,
  stopAfterResolve: true,
  loopRuns: [] as Array<{ protocol: string; appId: unknown }>,
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
      if (args[1].surface === "chat" || !booted.stopAfterResolve) return added;
      booted.delegatedAdditions.push({
        surface: args[1].surface,
        names: Object.keys(added),
        entries: added,
      });
      throw new Error("app actions resolved");
    },
  };
});

vi.mock("./agent-chat/action-filters-a2a.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-chat/action-filters-a2a.js")>();
  const stop = (protocol: string) => async (runOptions: any) => {
    booted.loopRuns.push({ protocol, appId: runOptions.appId });
    throw new Error("agent loop reached");
  };
  return {
    ...actual,
    runA2AAgentLoop: stop("a2a"),
    runMCPAgentLoop: stop("mcp"),
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
  {
    mcpEnabled = false,
    additionalActionSurfaces,
    appId,
    codeExecution,
    resolveActionSurface,
  }: Pick<
    AgentChatPluginOptions,
    | "additionalActionSurfaces"
    | "appId"
    | "codeExecution"
    | "resolveActionSurface"
  > & {
    mcpEnabled?: boolean;
  } = {},
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
    actions: () => ({
      "list-decks": entry("template list-decks"),
      "hidden-template-action": {
        ...entry("hidden template action"),
        agentTool: false,
      },
      "mcp-only-template-action": {
        ...entry("MCP-only template action"),
        agentTool: false,
        mcpTool: true,
      },
    }),
    a2aAgentDelegation: false,
    frameworkTools: "minimal",
    leanPrompt: true,
    mcp: { enabled: mcpEnabled },
    resolveAdditionalActions,
    additionalActionSurfaces,
    ...(appId ? { appId } : {}),
    ...(codeExecution ? { codeExecution } : {}),
    ...(resolveActionSurface ? { resolveActionSurface } : {}),
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
    booted.stopAfterResolve = true;
    booted.loopRuns.length = 0;
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
    await boot(
      async (details) => {
        seen.push(details);
        throw new Error("app resolver reached");
      },
      { additionalActionSurfaces: ["a2a"] },
    );

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
      { mcpEnabled: true, additionalActionSurfaces: ["mcp"] },
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
      { mcpEnabled: true, additionalActionSurfaces: ["a2a", "mcp"] },
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
    expect(delegatedNames()).toEqual([
      { surface: "a2a", names: ["user-registered-tool"] },
      { surface: "mcp", names: ["user-registered-tool"] },
    ]);
  });

  it("reserves trusted coding tools that request-scoped surfaces drop from chat", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await boot(
      async () => ({
        bash: entry("app bash"),
        "user-registered-tool": entry("user tool"),
      }),
      {
        codeExecution: { production: "trusted" },
        resolveActionSurface: async () => ({ mode: "default" }),
      },
    );

    const chatHandlers = booted.handlerOptions.filter(
      (options) => options.resolveAdditionalActions,
    );
    expect(chatHandlers.length).toBeGreaterThan(0);
    for (const options of chatHandlers) {
      expect(options.actions.bash).toBeUndefined();
      const added: Record<string, ActionEntry> =
        await options.resolveAdditionalActions({
          event: { path: "/_agent-native/agent-chat" },
          ownerEmail: "alice@example.com",
          orgId: "acme",
        });
      expect(added["user-registered-tool"]?.tool.description).toBe("user tool");
      expect(added.bash).toBeUndefined();
    }
  });

  it("reserves template actions hidden from the agent on every surface", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await boot(
      async () => ({
        "hidden-template-action": entry("app hidden"),
        "mcp-only-template-action": entry("app MCP-only"),
        "user-registered-tool": entry("user tool"),
      }),
      { mcpEnabled: true, additionalActionSurfaces: ["a2a", "mcp"] },
    );

    const chatHandlers = booted.handlerOptions.filter(
      (options) => options.resolveAdditionalActions,
    );
    expect(chatHandlers).toHaveLength(2);
    for (const options of chatHandlers) {
      const added: Record<string, ActionEntry> =
        await options.resolveAdditionalActions({
          event: { path: "/_agent-native/agent-chat" },
          ownerEmail: "alice@example.com",
          orgId: "acme",
        });
      expect(Object.keys(added)).toEqual(["user-registered-tool"]);
    }
    await runDelegated("alice@example.com", "task-hidden-template-names");
    expect(delegatedNames()).toEqual([
      { surface: "a2a", names: ["user-registered-tool"] },
      { surface: "mcp", names: ["user-registered-tool"] },
    ]);
  });

  it("keeps app actions off A2A and ask_app until the app opts in", async () => {
    const resolver = vi.fn(async () => ({
      "user-registered-tool": entry("user tool"),
    }));
    await boot(resolver, { mcpEnabled: true });

    await runDelegated("alice@example.com", "task-not-opted-in");

    expect(resolver).not.toHaveBeenCalled();
    expect(delegatedNames()).toEqual([
      { surface: "a2a", names: [] },
      { surface: "mcp", names: [] },
    ]);
  });

  it("gives each delegated caller only their own entries, resolved once per run", async () => {
    const resolver = vi.fn(async ({ ownerEmail }: { ownerEmail: string }) => ({
      [`tool-for-${ownerEmail.split("@")[0]}`]: entry(`${ownerEmail} tool`),
    }));
    await boot(resolver, {
      mcpEnabled: true,
      additionalActionSurfaces: ["a2a", "mcp"],
    });

    await Promise.all([
      runDelegated("alice@example.com", "task-alice"),
      runDelegated("bob@example.com", "task-bob"),
    ]);

    // Two callers on two surfaces: four runs, one resolution each.
    expect(resolver).toHaveBeenCalledTimes(4);
    const names = delegatedNames();
    expect(names).toHaveLength(4);
    expect(names).toEqual(
      expect.arrayContaining([
        { surface: "a2a", names: ["tool-for-alice"] },
        { surface: "mcp", names: ["tool-for-alice"] },
        { surface: "a2a", names: ["tool-for-bob"] },
        { surface: "mcp", names: ["tool-for-bob"] },
      ]),
    );

    const aliceTool = booted.delegatedAdditions.find(({ names }) =>
      names.includes("tool-for-alice"),
    )!.entries["tool-for-alice"];
    await expect(
      runWithRequestContext(
        { userEmail: "bob@example.com", orgId: "acme" },
        () => aliceTool.run({}),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      runWithRequestContext(
        { userEmail: "alice@example.com", orgId: "acme" },
        () => aliceTool.run({}),
      ),
    ).resolves.toBe("alice@example.com tool");
  });
});

describe("delegated loops", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    booted.stopAfterResolve = false;
    booted.loopRuns.length = 0;
  });

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
    booted.stopAfterResolve = true;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("run A2A and ask_app with the app's identity so access policies can resolve", async () => {
    await boot(async () => ({ "user-registered-tool": entry("user tool") }), {
      mcpEnabled: true,
      additionalActionSurfaces: ["a2a", "mcp"],
      appId: "slides",
    });

    await runDelegated("alice@example.com", "task-app-identity");

    expect(booted.loopRuns).toEqual([
      { protocol: "a2a", appId: "slides" },
      { protocol: "mcp", appId: "slides" },
    ]);
  });
});

function delegatedNames(): Array<{ surface: string; names: string[] }> {
  return booted.delegatedAdditions.map(({ surface, names }) => ({
    surface,
    names,
  }));
}

async function runDelegated(userEmail: string, taskId: string): Promise<void> {
  await runWithRequestContext({ userEmail, orgId: "acme" }, async () => {
    await booted
      .a2aConfig!.handler(
        { role: "user", parts: [{ type: "text", text: "list my decks" }] },
        {
          taskId,
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
      .catch(() => null);
    await booted.mcpConfig!.askAgent("list my decks").catch(() => null);
  });
}

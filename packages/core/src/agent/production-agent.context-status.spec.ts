import { randomUUID } from "node:crypto";

import { mockEvent } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRequestRunContext,
  runWithRequestContext,
  type RequestRunContext,
} from "../server/request-context.js";
import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";
import {
  createProductionAgentHandler,
  type ActionEntry,
  type ProductionAgentOptions,
} from "./production-agent.js";

const mockReadAppState = vi.hoisted(() =>
  vi.fn(async (_key: string): Promise<unknown> => null),
);
vi.mock("../application-state/script-helpers.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../application-state/script-helpers.js")
  >()),
  readAppState: mockReadAppState,
}));

const mockCallAgent = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]): Promise<string> => "remote answer"),
);
vi.mock("../a2a/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../a2a/client.js")>()),
  callAgent: mockCallAgent,
}));
vi.mock("../a2a/caller-auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../a2a/caller-auth.js")>()),
  resolveA2ACallerAuth: async () => ({
    apiKey: "test-key",
    userEmail: "owner@example.com",
    metadata: {},
  }),
}));

const instrumented = vi.hoisted(
  () => [] as Array<{ metadata?: Record<string, unknown> }>,
);
vi.mock("../observability/traces.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../observability/traces.js")>()),
  getObservabilityConfig: async () => ({ enabled: true }),
  instrumentAgentLoop: async (opts: {
    metadata?: Record<string, unknown>;
    runAgentLoop: (loopOpts: unknown) => Promise<unknown>;
    loopOpts: unknown;
  }) => {
    instrumented.push({ metadata: opts.metadata });
    return opts.runAgentLoop(opts.loopOpts);
  },
}));

const SCREEN_NOTE =
  "<context-note>Current screen unavailable this turn; call view-screen before editing or answering about the open page.</context-note>";

function viewScreen(run: ActionEntry["run"]): ActionEntry {
  return {
    tool: { description: "View the screen", parameters: { type: "object" } },
    readOnly: true,
    run,
  } as ActionEntry;
}

async function firstPrompt(
  options: Partial<ProductionAgentOptions> & {
    actions?: Record<string, ActionEntry>;
  } = {},
  request: { model?: string; effort?: string; references?: unknown[] } = {},
  { user = true }: { user?: boolean } = {},
): Promise<{ text: string; runContext: RequestRunContext | undefined }> {
  let text = "";
  let runContext: RequestRunContext | undefined;
  const engine: AgentEngine = {
    name: "test",
    label: "Test",
    defaultModel: "gpt-6-luna",
    supportedModels: ["gpt-6-luna", "gpt-5-6-terra"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(opts): AsyncIterable<EngineEvent> {
      const last = [...opts.messages]
        .reverse()
        .find((message: EngineMessage) => message.role === "user");
      text ||= (last?.content ?? [])
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");
      runContext ??= { ...getRequestRunContext() };
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "ok" }],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
  const handler = createProductionAgentHandler({
    systemPrompt: "Test",
    engine,
    actions: {},
    ...options,
  });
  const event = mockEvent(
    new Request("http://app.example.com/_agent-native/agent-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "How many sessions last week?",
        threadId: `thread-${randomUUID()}`,
        ...request,
      }),
    }),
  );
  const response = await runWithRequestContext(
    { ...(user ? { userEmail: "owner@example.com" } : {}), run: {} },
    () => handler(event),
  );
  if (response instanceof ReadableStream) {
    const reader = response.getReader();
    while (!(await reader.read()).done) {}
  }
  return { text, runContext };
}

describe("reference prefetch status", () => {
  beforeEach(() => {
    mockReadAppState.mockReset();
    mockReadAppState.mockResolvedValue(null);
  });

  it.each([
    ["timed_out", "timed out"],
    ["failed", "failed"],
  ] as const)(
    "tells the model preloaded references were unavailable when the app reports %s",
    async (status, reason) => {
      const { text, runContext } = await firstPrompt({
        prepareRequest: () => ({ status }),
      });

      expect(text).toContain(
        `<context-note>Preloaded context was unavailable this turn (${reason}); search for anything relevant with the available tools before answering.</context-note>`,
      );
      expect(runContext?.contextStatus?.prefetch).toBe(status);
    },
  );

  it("says only part of the context is missing when the app failed but core still injected something", async () => {
    const { text, runContext } = await firstPrompt({
      prepareRequest: () => ({
        status: "failed" as const,
        jevPromptCandidates: [
          {
            id: "analytics-reference-1",
            name: "Active users",
            scope: "analytics-catalog",
            description: "Approved active users definition.",
            metadata: { kind: "analytics-reference", similarity: "0.82" },
            content: "Metric: active users.",
          },
        ],
        jevFallbackCandidateIds: ["analytics-reference-1"],
      }),
    });

    expect(text).toContain(
      "<context-note>Some preloaded context was unavailable this turn (failed);",
    );
    expect(text).not.toContain("<context-note>Preloaded context");
    expect(runContext?.contextStatus?.prefetch).toBe("failed");
  });

  it("treats a status the hook mistyped as a failure, not as silence", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { text, runContext } = await firstPrompt({
      prepareRequest: () => ({ status: "timeout" }) as never,
    });

    expect(text).toContain(
      "Preloaded context was unavailable this turn (failed)",
    );
    expect(runContext?.contextStatus?.prefetch).toBe("failed");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"timeout"'));
  });

  it.each([
    ["an empty result", () => ({ status: "empty" as const })],
    ["an ok result", () => ({ status: "ok" as const })],
    ["the old return shape", () => ({ jevPromptCandidates: [] })],
    ["no return value", () => undefined],
  ])("stays silent for %s", async (_label, prepareRequest) => {
    const { text } = await firstPrompt({ prepareRequest });

    expect(text).not.toContain("<context-note>");
  });
});

describe("screen context status", () => {
  beforeEach(() => {
    mockReadAppState.mockReset();
    mockReadAppState.mockResolvedValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("notes an unavailable screen when view-screen throws, and says so in the run context", async () => {
    const { text, runContext } = await firstPrompt({
      actions: {
        "view-screen": viewScreen(async () => {
          throw new Error("db not ready");
        }),
      },
    });

    expect(text).toContain(SCREEN_NOTE);
    expect(runContext?.contextStatus?.screen).toBe("failed");
  });

  it("reports one note when the screen and the URL both fail", async () => {
    mockReadAppState.mockRejectedValue(new Error("db not ready"));

    const { text } = await firstPrompt();

    expect(text.split("Current screen unavailable")).toHaveLength(2);
  });

  it("notes an unreadable selection", async () => {
    mockReadAppState.mockImplementation(async (key: string) => {
      if (key === "pending-selection-context") throw new Error("db not ready");
      return null;
    });

    const { text, runContext } = await firstPrompt();

    expect(text).toContain(
      "<context-note>Selected text unavailable this turn; ask the user to paste it if the request refers to a selection.</context-note>",
    );
    expect(runContext?.contextStatus?.screen).toBe("failed");
  });

  it("does not send the model to a view-screen tool the app doesn't have", async () => {
    mockReadAppState.mockRejectedValue(new Error("db not ready"));

    const { text } = await firstPrompt();

    expect(text).toContain("<context-note>Current screen unavailable");
    expect(text).not.toContain("view-screen");
  });

  it("stays silent when there is no request user to read state for", async () => {
    mockReadAppState.mockRejectedValue(
      new Error(
        "Application state access requires an authenticated request context or AGENT_USER_EMAIL env var",
      ),
    );

    const { text, runContext } = await firstPrompt({}, {}, { user: false });

    expect(text).not.toContain("<context-note>");
    expect(runContext?.contextStatus?.screen).toBe("empty");
  });

  describe("for a referenced agent", () => {
    const reference = {
      type: "agent",
      name: "Sales Agent",
      path: "https://sales.example.test",
      source: "mention",
      refId: "ref-1",
    };

    beforeEach(() => mockCallAgent.mockClear());

    it("is not told to call a tool it doesn't have", async () => {
      const { text } = await firstPrompt(
        {
          actions: {
            "view-screen": viewScreen(async () => {
              throw new Error("db not ready");
            }),
          },
        },
        { references: [reference] },
      );

      expect(text).toContain(SCREEN_NOTE);
      expect(mockCallAgent).toHaveBeenCalledOnce();
      expect(String(mockCallAgent.mock.calls[0]?.[1])).not.toContain(
        "<context-note>",
      );
    });

    it("still gets the screen when it loads", async () => {
      await firstPrompt(
        {
          actions: {
            "view-screen": viewScreen(async () => "Dashboard: Growth"),
          },
        },
        { references: [reference] },
      );

      expect(String(mockCallAgent.mock.calls[0]?.[1])).toContain(
        "<current-screen>\nDashboard: Growth",
      );
    });
  });

  it("stays silent when there is simply no screen to show", async () => {
    const { text, runContext } = await firstPrompt({
      actions: { "view-screen": viewScreen(async () => "(no output)") },
    });

    expect(text).not.toContain("<context-note>");
    expect(runContext?.contextStatus?.screen).toBe("empty");
  });

  it("injects the screen with no note when it loads", async () => {
    const { text, runContext } = await firstPrompt({
      actions: { "view-screen": viewScreen(async () => "Dashboard: Growth") },
    });

    expect(text).toContain("<current-screen>\nDashboard: Growth");
    expect(text).not.toContain("<context-note>");
    expect(runContext?.contextStatus?.screen).toBe("ok");
  });
});

describe("run trace metadata", () => {
  beforeEach(() => {
    mockReadAppState.mockReset();
    mockReadAppState.mockResolvedValue(null);
    instrumented.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("records the model, how it was chosen, the reasoning effort and the grounding statuses", async () => {
    await firstPrompt({
      prepareRequest: () => ({ status: "timed_out" }),
      actions: {
        "view-screen": viewScreen(async () => {
          throw new Error("db not ready");
        }),
      },
    });

    expect(instrumented.at(-1)?.metadata).toMatchObject({
      modelSelectionSource: "default",
      reasoningEffortRequested: "high",
      contextPrefetchStatus: "timed_out",
      screenContextStatus: "failed",
    });
  });

  it("records an explicit request's model source and effort", async () => {
    await firstPrompt({}, { model: "gpt-5-6-terra", effort: "low" });

    expect(instrumented.at(-1)?.metadata).toMatchObject({
      modelSelectionSource: "request",
      reasoningEffortRequested: "low",
    });
    expect(instrumented.at(-1)?.metadata).not.toHaveProperty("reasoningEffort");
  });
});

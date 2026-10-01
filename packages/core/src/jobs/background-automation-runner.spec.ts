import { afterAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [] as unknown[], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [] as unknown[], rowsAffected: info.changes };
  }),
};

vi.mock(import("../db/client.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getDbExec: () => rawClient };
});

const getThreadMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: "thread-1",
    title: "Job: daily-digest",
    preview: "",
    threadData: "{}",
    messageCount: 0,
  })),
);
const updateThreadDataMock = vi.hoisted(() => vi.fn(async () => {}));
const createThreadMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ id: "thread-1" })),
);

vi.mock("../agent/engine/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../agent/engine/index.js")>();
  return {
    ...actual,
    // Delegates to the real check unless a test overrides it.
    isResolvedEngineUsableForRequest: vi.fn(
      actual.isResolvedEngineUsableForRequest,
    ),
  };
});

vi.mock("../agent/run-loop-with-resume.js", () => ({
  runAgentLoopDirectWithSoftTimeout: vi.fn(async () => ({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model: "test-model",
  })),
}));

vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
  getThread: getThreadMock,
  updateThreadData: updateThreadDataMock,
  withThreadDataLock: async (_threadId: string, fn: () => Promise<unknown>) =>
    fn(),
}));

vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: () => [],
  filterInitialEngineTools: (tools: unknown[]) => tools,
  resolveOwnerEngineApiKey: vi.fn(async () => ({
    apiKey: undefined,
    apiKeyEnvVar: undefined,
  })),
  runAgentLoop: vi.fn(),
}));

vi.mock("../secrets/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../secrets/storage.js")>()),
  readAppSecret: vi.fn(async () => null),
  readAppSecrets: vi.fn(async () => new Map()),
}));

const { BACKGROUND_RUN_HARD_TIMEOUT_MS, runBackgroundAutomation } =
  await import("./background-automation-runner.js");

async function abortReasonOf(runId: string): Promise<string | null> {
  const row = (await pglite
    .prepare(`SELECT abort_reason FROM agent_runs WHERE id = ?`)
    .get(runId)) as { abort_reason: string | null } | undefined;
  return row?.abort_reason ?? null;
}

async function dispatchModeOf(runId: string): Promise<string | null> {
  const row = (await pglite
    .prepare(`SELECT dispatch_mode FROM agent_runs WHERE id = ?`)
    .get(runId)) as { dispatch_mode: string | null } | undefined;
  return row?.dispatch_mode ?? null;
}

const testEngine = {
  name: "test",
  defaultModel: "test-model",
  supportedModels: ["test-model"],
} as any;

describe("runBackgroundAutomation — background-run self-claim", () => {
  it("keeps the outer hard timeout at the ten-minute background budget", () => {
    expect(BACKGROUND_RUN_HARD_TIMEOUT_MS).toBe(10 * 60_000);
  });

  it("self-claims its own run into background-processing instead of leaving it as an unclaimed background dispatch", async () => {
    const automation = {
      name: "daily-digest",
      meta: { schedule: "* * * * *", enabled: true, model: "test-model" },
      body: "Summarize the inbox.",
      resource: {
        owner: "alice@agent-native.test",
        path: "jobs/daily-digest.md",
      } as any,
    };

    const { runId } = await runBackgroundAutomation(
      {
        automation,
        ownerEmail: "alice@agent-native.test",
        prompt: "Summarize the inbox.",
        threadTitle: "Job: daily-digest",
        runIdPrefix: "job-daily-digest",
        usageLabel: "recurring-job:daily-digest",
      },
      {
        getActions: () => ({}),
        getSystemPrompt: async () => "system",
        engine: testEngine,
      },
    );

    await expect(dispatchModeOf(runId)).resolves.toBe("background-processing");
  });

  it("counts setup time against an absolute event deadline", async () => {
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockClear();
    const now = Date.now();
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now);

    try {
      await expect(
        runBackgroundAutomation(
          {
            automation: {
              name: "deadline-digest",
              meta: {
                schedule: "* * * * *",
                enabled: true,
                model: "test-model",
              },
              body: "Summarize the inbox.",
              resource: {
                owner: "alice@agent-native.test",
                path: "jobs/deadline-digest.md",
              } as any,
            },
            ownerEmail: "alice@agent-native.test",
            prompt: "Summarize the inbox.",
            threadTitle: "Job: deadline-digest",
            runIdPrefix: "job-deadline-digest",
            usageLabel: "recurring-job:deadline-digest",
            hardDeadlineAt: now + 100,
          },
          {
            getActions: async () => {
              dateNow.mockReturnValue(now + 101);
              return {};
            },
            getSystemPrompt: async () => "system",
            engine: testEngine,
          },
        ),
      ).rejects.toMatchObject({
        errorCode: "background_automation_hard_timeout",
      });
      expect(runAgentLoopDirectWithSoftTimeout).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
    }
  });

  it("runs scheduled work under the background timeout regime, not the interactive clamp", async () => {
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockClear();

    await runBackgroundAutomation(
      {
        automation: {
          name: "weekly-report",
          meta: {
            schedule: "* * * * *",
            enabled: true,
            model: "test-model",
            maxIterations: 9,
            maxRunInputTokens: 123_456,
          },
          body: "Render the weekly report.",
          resource: {
            owner: "alice@agent-native.test",
            path: "jobs/weekly-report.md",
          } as any,
        },
        ownerEmail: "alice@agent-native.test",
        prompt: "Render the weekly report.",
        threadTitle: "Job: weekly-report",
        runIdPrefix: "job-weekly-report",
        usageLabel: "recurring-job:weekly-report",
      },
      {
        getActions: () => ({}),
        getSystemPrompt: async () => "system",
        engine: testEngine,
        appId: "calendar",
      },
    );

    const call = vi.mocked(runAgentLoopDirectWithSoftTimeout).mock.calls.at(-1);
    expect(call?.[0]).toMatchObject({
      appId: "calendar",
      maxIterations: 9,
      maxRunInputTokens: 123_456,
      maxOutputTokens: 64_000,
    });
    expect(call?.[2]).toMatchObject({ backgroundFunction: true });
    expect(call?.[3]).toBeDefined();
    expect(call?.[1]).toBeLessThan(BACKGROUND_RUN_HARD_TIMEOUT_MS);
  });

  it("records unavailable configured MCP tools with a specific failure code", async () => {
    const automationName = "missing-mcp-tool-check";
    await expect(
      runBackgroundAutomation(
        {
          automation: {
            name: automationName,
            meta: {
              schedule: "* * * * *",
              enabled: true,
              mcpTools: ["mcp__linear__search_issues"],
            },
            body: "Check Linear.",
            resource: {
              owner: "alice@agent-native.test",
              path: `jobs/${automationName}.md`,
            } as any,
          },
          ownerEmail: "alice@agent-native.test",
          prompt: "Check Linear.",
          threadTitle: "Job: missing MCP tool check",
          runIdPrefix: "job-missing-mcp-tool-check",
          usageLabel: "recurring-job:missing-mcp-tool-check",
        },
        {
          getActions: () => ({}),
          getSystemPrompt: async () => "system",
          engine: testEngine,
          appId: "calendar",
        },
      ),
    ).rejects.toMatchObject({ errorCode: "missing_tools" });

    const run = (await pglite
      .prepare(`SELECT error_code FROM automation_runs WHERE automation = ?`)
      .get(automationName)) as { error_code: string } | undefined;
    expect(run?.error_code).toBe("missing_tools");
  });

  it("forwards the automation's configured reasoningEffort into the agent loop", async () => {
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockClear();

    const reasoningEngine = {
      name: "test",
      defaultModel: "gpt-5.6-luna",
      supportedModels: ["gpt-5.6-luna"],
    } as any;

    await runBackgroundAutomation(
      {
        automation: {
          name: "weekly-report",
          meta: {
            schedule: "* * * * *",
            enabled: true,
            model: "gpt-5.6-luna",
            reasoningEffort: "low",
          },
          body: "Render the weekly report.",
          resource: {
            owner: "alice@agent-native.test",
            path: "jobs/weekly-report.md",
          } as any,
        },
        ownerEmail: "alice@agent-native.test",
        prompt: "Render the weekly report.",
        threadTitle: "Job: weekly-report",
        runIdPrefix: "job-weekly-report-effort",
        usageLabel: "recurring-job:weekly-report",
      },
      {
        getActions: () => ({}),
        getSystemPrompt: async () => "system",
        engine: reasoningEngine,
      },
    );

    const call = vi.mocked(runAgentLoopDirectWithSoftTimeout).mock.calls.at(-1);
    expect(call?.[0]).toMatchObject({ reasoningEffort: "low" });
  });

  it("still runs the automation when the run-history write fails", async () => {
    const runHistory = await import("./run-history.js");
    const startSpy = vi
      .spyOn(runHistory, "startAutomationRun")
      .mockRejectedValue(new Error("history table unavailable"));
    const attachSpy = vi
      .spyOn(runHistory, "attachAutomationRunThread")
      .mockRejectedValue(new Error("history table unavailable"));
    const finishSpy = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockRejectedValue(new Error("history table unavailable"));

    try {
      const { runId } = await runBackgroundAutomation(
        {
          automation: {
            name: "resilient-digest",
            meta: { schedule: "* * * * *", enabled: true, model: "test-model" },
            body: "Summarize the inbox.",
            resource: {
              owner: "alice@agent-native.test",
              path: "jobs/resilient-digest.md",
            } as any,
          },
          ownerEmail: "alice@agent-native.test",
          prompt: "Summarize the inbox.",
          threadTitle: "Job: resilient-digest",
          runIdPrefix: "job-resilient-digest",
          usageLabel: "recurring-job:resilient-digest",
        },
        {
          getActions: () => ({}),
          getSystemPrompt: async () => "system",
          engine: testEngine,
        },
      );

      expect(runId).toBeTruthy();
      expect(startSpy).toHaveBeenCalled();
      expect(attachSpy).not.toHaveBeenCalled();
      expect(finishSpy).not.toHaveBeenCalled();
    } finally {
      startSpy.mockRestore();
      attachSpy.mockRestore();
      finishSpy.mockRestore();
    }
  });
});

function persistedRepo() {
  const threadData = updateThreadDataMock.mock.calls.at(-1)?.[1];
  expect(typeof threadData).toBe("string");
  return JSON.parse(threadData as string) as {
    messages: Array<{ message?: { role?: string; content?: unknown[] } }>;
  };
}

function assistantMessage() {
  const repo = persistedRepo();
  const entry = repo.messages[1];
  return (entry?.message ?? entry) as {
    content?: unknown[];
    status?: { type?: string; reason?: string };
    metadata?: {
      custom?: { continued?: unknown; runError?: { errorCode?: string } };
    };
  };
}

function assistantContent() {
  const content = assistantMessage().content;
  return Array.isArray(content) ? content : [];
}

describe("runBackgroundAutomation — thread transcript", () => {
  it("persists the prompt and tool-call turn, keeping the Job title", async () => {
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
      async (opts) => {
        opts.send?.({ type: "text", text: "Checking Slack." });
        opts.send?.({
          type: "tool_start",
          id: "tc_1",
          tool: "poll-slack-channel",
          input: { channel: "C123" },
        });
        opts.send?.({
          type: "tool_done",
          id: "tc_1",
          tool: "poll-slack-channel",
          result: JSON.stringify({ checked: 1 }),
        });
        return {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "test-model",
        };
      },
    );
    updateThreadDataMock.mockClear();

    await runBackgroundAutomation(
      {
        automation: {
          name: "slack-feedback",
          meta: { schedule: "* * * * *", enabled: true, model: "test-model" },
          body: "Poll Slack.",
          resource: {
            owner: "alice@agent-native.test",
            path: "jobs/slack-feedback.md",
          } as any,
        },
        ownerEmail: "alice@agent-native.test",
        prompt: "Poll the configured Slack channel.",
        threadTitle: "Job: Slack Feedback — Aug 17, 2026",
        runIdPrefix: "job-slack-feedback",
        usageLabel: "recurring-job:slack-feedback",
      },
      {
        getActions: () => ({}),
        getSystemPrompt: async () => "system",
        engine: testEngine,
      },
    );

    expect(updateThreadDataMock).toHaveBeenCalledTimes(1);
    const [, threadData, title, , messageCount] =
      updateThreadDataMock.mock.calls[0];
    expect(title).toBe("Job: Slack Feedback — Aug 17, 2026");
    expect(messageCount).toBe(2);
    expect(JSON.parse(threadData as string).messages).toHaveLength(2);
    expect(assistantMessage().status).toEqual({
      type: "complete",
      reason: "stop",
    });
    expect(assistantContent()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call",
          toolName: "poll-slack-channel",
        }),
      ]),
    );
  });

  it("persists a partial turn when the run is cut off", async () => {
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
      async (opts) => {
        opts.send?.({ type: "text", text: "Started polling." });
        opts.send?.({ type: "auto_continue", reason: "no_progress" });
        return {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "test-model",
        };
      },
    );
    updateThreadDataMock.mockClear();

    await expect(
      runBackgroundAutomation(
        {
          automation: {
            name: "cut-off-digest",
            meta: { schedule: "* * * * *", enabled: true, model: "test-model" },
            body: "Summarize the inbox.",
            resource: {
              owner: "alice@agent-native.test",
              path: "jobs/cut-off-digest.md",
            } as any,
          },
          ownerEmail: "alice@agent-native.test",
          prompt: "Summarize the inbox.",
          threadTitle: "Job: cut-off-digest — Aug 17, 2026",
          runIdPrefix: "job-cut-off-digest",
          usageLabel: "recurring-job:cut-off-digest",
        },
        {
          getActions: () => ({}),
          getSystemPrompt: async () => "system",
          engine: testEngine,
        },
      ),
    ).rejects.toThrow(/cut off before finishing \(no_progress\)/);

    expect(updateThreadDataMock).toHaveBeenCalled();
    const [, , title] = updateThreadDataMock.mock.calls[0];
    expect(title).toBe("Job: cut-off-digest — Aug 17, 2026");
    expect(assistantMessage().status).toEqual({
      type: "incomplete",
      reason: "error",
    });
    expect(assistantMessage().metadata?.custom?.continued).toBeUndefined();
    expect(assistantMessage().metadata?.custom?.runError).toMatchObject({
      errorCode: "background_automation_cut_off",
    });
    expect(assistantContent()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringMatching(
            /Started polling\.[\s\S]*cut off before finishing \(no_progress\)/,
          ),
        }),
      ]),
    );
  });

  it("reports a cut-off automation to the error-capture system", async () => {
    const { registerErrorCaptureProvider } =
      await import("../server/capture-error.js");
    const captured: Array<{ error: unknown; context: Record<string, any> }> =
      [];
    const unregister = registerErrorCaptureProvider(
      "background-automation-spec",
      (error, context) => {
        captured.push({ error, context: context as Record<string, any> });
        return undefined;
      },
    );

    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
      async (opts) => {
        opts.send?.({ type: "text", text: "Started polling." });
        opts.send?.({ type: "auto_continue", reason: "no_progress" });
        return {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "test-model",
        };
      },
    );

    try {
      await expect(
        runBackgroundAutomation(
          {
            automation: {
              name: "cut-off-digest",
              meta: {
                schedule: "* * * * *",
                enabled: true,
                model: "test-model",
              },
              body: "Summarize the inbox.",
              resource: {
                owner: "alice@agent-native.test",
                path: "jobs/cut-off-digest.md",
              } as any,
            },
            ownerEmail: "alice@agent-native.test",
            prompt: "Summarize the inbox.",
            threadTitle: "Job: cut-off-digest — Aug 17, 2026",
            runIdPrefix: "job-cut-off-digest",
            usageLabel: "recurring-job:cut-off-digest",
          },
          {
            getActions: () => ({}),
            getSystemPrompt: async () => "system",
            engine: testEngine,
          },
        ),
      ).rejects.toThrow(/cut off before finishing \(no_progress\)/);
    } finally {
      unregister();
    }

    expect(captured).toHaveLength(1);
    expect(String((captured[0].error as Error).message)).toMatch(
      /cut off before finishing \(no_progress\)/,
    );
    expect(captured[0].context.tags).toMatchObject({
      area: "background-automation",
      automation: "cut-off-digest",
      scope: "personal",
    });
    expect(captured[0].context.aiTraceId).toMatch(/^job-cut-off-digest-/);
  });

  it("persists a partial turn when the hard timeout fires", async () => {
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
      async (opts) => {
        opts.send?.({ type: "text", text: "Still working." });
        await new Promise<void>((_resolve, reject) => {
          const signal = opts.signal;
          if (signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
        return {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "test-model",
        };
      },
    );
    updateThreadDataMock.mockClear();

    const realSetTimeout = globalThis.setTimeout;
    const pendingHardTimeouts: Array<() => void> = [];
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((
        handler: TimerHandler,
        delay?: number,
        ...args: unknown[]
      ) => {
        if (delay === 120_000) {
          pendingHardTimeouts.push(() => {
            if (typeof handler === "function") handler(...args);
          });
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }
        return realSetTimeout(
          handler as Parameters<typeof setTimeout>[0],
          delay,
          ...args,
        );
      }) as typeof setTimeout);

    try {
      const runPromise = runBackgroundAutomation(
        {
          automation: {
            name: "hard-timeout-digest",
            meta: {
              schedule: "* * * * *",
              enabled: true,
              model: "test-model",
            },
            body: "Summarize the inbox.",
            resource: {
              owner: "alice@agent-native.test",
              path: "jobs/hard-timeout-digest.md",
            } as any,
          },
          ownerEmail: "alice@agent-native.test",
          prompt: "Summarize the inbox.",
          threadTitle: "Job: hard-timeout-digest — Aug 18, 2026",
          runIdPrefix: "job-hard-timeout-digest",
          usageLabel: "recurring-job:hard-timeout-digest",
          hardTimeoutMs: 120_000,
        },
        {
          getActions: () => ({}),
          getSystemPrompt: async () => "system",
          engine: testEngine,
        },
      );

      await vi.waitFor(() => {
        expect(pendingHardTimeouts.length).toBe(1);
      });
      pendingHardTimeouts[0]!();

      await expect(runPromise).rejects.toThrow(/timed out after 2 minutes/);
      const hardTimedOutRunId = (await pglite
        .prepare(
          `SELECT id FROM agent_runs WHERE id LIKE 'job-hard-timeout-digest%' ORDER BY started_at DESC LIMIT 1`,
        )
        .get()) as { id: string } | undefined;
      expect(hardTimedOutRunId?.id).toBeTruthy();
      await expect(abortReasonOf(hardTimedOutRunId!.id)).resolves.toBe(
        "background_automation_hard_timeout",
      );
      expect(updateThreadDataMock).toHaveBeenCalled();
      const [, , title] = updateThreadDataMock.mock.calls[0];
      expect(title).toBe("Job: hard-timeout-digest — Aug 18, 2026");
      expect(assistantMessage().status).toEqual({
        type: "incomplete",
        reason: "error",
      });
      expect(assistantMessage().metadata?.custom?.continued).toBeUndefined();
      expect(assistantMessage().metadata?.custom?.runError).toMatchObject({
        errorCode: "background_automation_hard_timeout",
      });
      expect(assistantContent()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.stringMatching(
              /Still working\.[\s\S]*timed out after 2 minutes/,
            ),
          }),
        ]),
      );
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});

// Every test above supplies `deps.engine`, which is what let the credential
// capture below stay broken: production never sets it (agent-chat-plugin builds
// SchedulerDeps without one) and both jobs/scheduler.ts and
// triggers/dispatcher.ts reach this path. On a Builder-credits site the engine
// must resolve through the gateway lane; resolving the identity lane by hand
// here left every scheduled and event automation dead while chat still worked.
describe("runBackgroundAutomation — engine credentials with no deps.engine", () => {
  const GATEWAY_TOKEN = "btk-site-token";
  const GATEWAY_SPACE_ID = "space-abc";

  it("streams through the deployment's Builder-credits pair", async () => {
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockClear();

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.BUILDER_PRIVATE_KEY;
    delete process.env.BUILDER_PUBLIC_KEY;
    vi.stubEnv("BUILDER_GATEWAY_TOKEN", GATEWAY_TOKEN);
    vi.stubEnv("BUILDER_GATEWAY_SPACE_ID", GATEWAY_SPACE_ID);
    vi.stubEnv("BUILDER_GATEWAY_BASE_URL", "https://test.example/gateway/v1");

    const { registerBuiltinEngines } = await import("../agent/engine/index.js");
    registerBuiltinEngines();

    try {
      await runBackgroundAutomation(
        {
          automation: {
            name: "credits-digest",
            meta: { schedule: "* * * * *", enabled: true },
            body: "Summarize the inbox.",
            resource: {
              owner: "alice@agent-native.test",
              path: "jobs/credits-digest.md",
            } as any,
          },
          ownerEmail: "alice@agent-native.test",
          prompt: "Summarize the inbox.",
          threadTitle: "Job: credits-digest",
          runIdPrefix: "job-credits-digest",
          usageLabel: "recurring-job:credits-digest",
        },
        { getActions: () => ({}), getSystemPrompt: async () => "system" },
      );

      const engine = vi
        .mocked(runAgentLoopDirectWithSoftTimeout)
        .mock.calls.at(-1)?.[0].engine;
      expect(engine?.name).toBe("builder");

      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          new Response(
            `${JSON.stringify({ type: "stop", reason: "end_turn" })}\n`,
            { status: 200, headers: { "Content-Type": "application/jsonl" } },
          ),
        );
      vi.stubGlobal("fetch", fetchSpy);

      const events: any[] = [];
      for await (const event of engine!.stream({
        model: engine!.defaultModel,
        systemPrompt: "system",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        tools: [],
        abortSignal: new AbortController().signal,
      })) {
        events.push(event);
      }

      expect(events.at(-1)).toMatchObject({ type: "stop", reason: "end_turn" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const headers = fetchSpy.mock.calls[0][1].headers as Record<
        string,
        string
      >;
      expect(headers.Authorization).toBe(`Bearer ${GATEWAY_TOKEN}`);
      expect(headers["x-builder-api-key"]).toBe(GATEWAY_SPACE_ID);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

async function countRowsWithPrefix(prefix: string): Promise<number> {
  const table = (await pglite
    .prepare(`SELECT to_regclass('agent_runs') AS name`)
    .get()) as { name: string | null };
  if (!table.name) return 0;
  const row = (await pglite
    .prepare(`SELECT count(*) AS n FROM agent_runs WHERE id LIKE ?`)
    .get(`${prefix}%`)) as { n: number | string };
  return Number(row.n);
}

function precondition(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    meta: {
      schedule: "*/15 * * * *",
      enabled: true,
      model: "test-model",
      ...overrides,
    },
    body: "Send the reminders.",
    resource: {
      owner: "alice@agent-native.test",
      path: `jobs/${name}.md`,
    } as any,
  };
}

function runOptions(
  automation: ReturnType<typeof precondition>,
  overrides: Record<string, unknown> = {},
) {
  return {
    automation,
    ownerEmail: "alice@agent-native.test",
    prompt: "Send the reminders.",
    threadTitle: `Job: ${automation.name}`,
    runIdPrefix: `job-${automation.name}`,
    usageLabel: `recurring-job:${automation.name}`,
    ...overrides,
  };
}

const standardDeps = {
  getActions: () => ({}),
  getSystemPrompt: async () => "system",
  engine: testEngine,
};

describe("runBackgroundAutomation — preconditions fail before any thread or run exists", () => {
  async function usableCheck() {
    const engineIndex = await import("../agent/engine/index.js");
    return vi.mocked(engineIndex.isResolvedEngineUsableForRequest);
  }

  it("records missing_credentials with its real cause and creates no thread or run", async () => {
    const usable = await usableCheck();
    usable.mockResolvedValueOnce(false);
    createThreadMock.mockClear();
    const automation = precondition("no-credentials");

    await expect(
      runBackgroundAutomation(runOptions(automation), standardDeps),
    ).rejects.toMatchObject({
      errorCode: "missing_credentials",
      message: expect.stringContaining("No LLM provider is connected"),
    });

    expect(createThreadMock).not.toHaveBeenCalled();
    await expect(countRowsWithPrefix("job-no-credentials")).resolves.toBe(0);
    const history = (await pglite
      .prepare(
        `SELECT status, error, error_code FROM automation_runs WHERE automation = ?`,
      )
      .get("no-credentials")) as {
      status: string;
      error: string;
      error_code: string;
    };
    expect(history).toMatchObject({
      status: "error",
      error_code: "missing_credentials",
    });
    expect(history.error).toContain("No LLM provider is connected");
    expect(history.error).not.toContain("ended with status");
  });

  async function seedOrg(members: Array<[email: string, role: string]>) {
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE);
      INSERT INTO "user" (id, email) VALUES ('u-alice', 'alice@agent-native.test')
        ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS org_members (
        org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
        federation_removal_pending_at BIGINT
      );
      DELETE FROM org_members;
    `);
    for (const [email, role] of members) {
      await pglite
        .prepare(
          `INSERT INTO org_members (org_id, email, role) VALUES ('acme', ?, ?)`,
        )
        .run(email, role);
    }
  }

  async function orgJobAlertRecipient(name: string) {
    const usable = await usableCheck();
    usable.mockResolvedValueOnce(false);
    const automation = precondition(name, {
      runAs: "shared",
      orgId: "acme",
      createdBy: "alice@agent-native.test",
    });
    automation.resource.owner = "__organization__:acme";
    await expect(
      runBackgroundAutomation(
        runOptions(automation, {
          ownerEmail: "__organization__:acme",
          orgId: "acme",
        }),
        standardDeps,
      ),
    ).rejects.toMatchObject({ errorCode: "missing_credentials" });
    const history = (await pglite
      .prepare(
        `SELECT notification_email FROM automation_runs WHERE automation = ?`,
      )
      .get(name)) as { notification_email: string | null };
    return history.notification_email;
  }

  it("alerts an org owner, not a creator who has left the organization", async () => {
    await seedOrg([["bob@agent-native.test", "owner"]]);
    expect(await orgJobAlertRecipient("org-creator-left")).toBe(
      "bob@agent-native.test",
    );
  });

  it("records no recipient, loudly, when nobody in the organization can be alerted", async () => {
    await seedOrg([["carol@agent-native.test", "member"]]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await orgJobAlertRecipient("org-no-recipient")).toBeNull();
      expect(
        errors.mock.calls.some((call) =>
          String(call[0]).includes("automation_alert_no_recipient"),
        ),
      ).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it("names who can fix a shared organization job and alerts its creator, not the pseudo owner", async () => {
    await seedOrg([["alice@agent-native.test", "member"]]);
    const usable = await usableCheck();
    usable.mockResolvedValueOnce(false);
    const automation = precondition("org-reminders", {
      runAs: "shared",
      orgId: "acme",
      createdBy: "alice@agent-native.test",
    });
    automation.resource.owner = "__organization__:acme";

    await expect(
      runBackgroundAutomation(
        runOptions(automation, {
          ownerEmail: "__organization__:acme",
          orgId: "acme",
        }),
        standardDeps,
      ),
    ).rejects.toMatchObject({
      errorCode: "missing_credentials",
      message: expect.stringMatching(
        /organization "acme".*admin.*personal connection is not used/s,
      ),
    });

    const history = (await pglite
      .prepare(
        `SELECT notification_email FROM automation_runs WHERE automation = ?`,
      )
      .get("org-reminders")) as { notification_email: string | null };
    expect(history.notification_email).toBe("alice@agent-native.test");
  });

  it("types the tool supplier's untyped missing-tools error and creates no thread", async () => {
    createThreadMock.mockClear();
    await expect(
      runBackgroundAutomation(
        runOptions(precondition("supplier-missing-tools")),
        {
          ...standardDeps,
          getActions: () => {
            throw new Error(
              "Configured MCP tools are unavailable in this run: mcp__codex_apps__github_create_pr. Reconnect the MCP server or update the automation's capability list.",
            );
          },
        },
      ),
    ).rejects.toThrow("Configured MCP tools are unavailable");

    expect(createThreadMock).not.toHaveBeenCalled();
    const history = (await pglite
      .prepare(
        `SELECT error, error_code FROM automation_runs WHERE automation = ?`,
      )
      .get("supplier-missing-tools")) as { error: string; error_code: string };
    expect(history.error_code).toBe("missing_tools");
    expect(history.error).toContain("mcp__codex_apps__github_create_pr");
  });

  it("does not call an unreadable credential store a missing credential", async () => {
    const usable = await usableCheck();
    const { CredentialStoreUnavailableError } =
      await import("../server/credential-provider.js");
    usable.mockRejectedValueOnce(new CredentialStoreUnavailableError());
    createThreadMock.mockClear();

    await expect(
      runBackgroundAutomation(
        runOptions(precondition("unreadable-store")),
        standardDeps,
      ),
    ).rejects.toMatchObject({ errorCode: "credential_store_unavailable" });
    expect(createThreadMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported delivery platform before running the agent", async () => {
    createThreadMock.mockClear();
    const automation = precondition("bad-delivery", {
      deliveryPlatform: "carrier-pigeon",
      deliveryDestination: "coop-1",
    });

    await expect(
      runBackgroundAutomation(runOptions(automation), standardDeps),
    ).rejects.toMatchObject({
      errorCode: "config_invalid",
      message: expect.stringContaining("carrier-pigeon"),
    });
    expect(createThreadMock).not.toHaveBeenCalled();
    await expect(countRowsWithPrefix("job-bad-delivery")).resolves.toBe(0);
  });

  it("emails only the run that pauses the automation", async () => {
    const usable = await usableCheck();
    const runHistory = await import("./run-history.js");
    const finishSpy = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockResolvedValue(undefined);
    try {
      for (const [streak, quiet] of [
        [undefined, true],
        [1, true],
        [2, false],
      ] as const) {
        usable.mockResolvedValueOnce(false);
        finishSpy.mockClear();
        const automation = precondition(`streak-${streak ?? 0}`, {
          ...(streak
            ? {
                lastErrorCode: "missing_credentials",
                consecutiveFailures: streak,
              }
            : {}),
        });
        await expect(
          runBackgroundAutomation(runOptions(automation), standardDeps),
        ).rejects.toMatchObject({ errorCode: "missing_credentials" });

        const [, status, error, code, options] = finishSpy.mock.calls[0]!;
        expect(status).toBe("error");
        expect(code).toBe("missing_credentials");
        if (quiet) {
          expect(options).toEqual({ notify: false });
          expect(error).not.toContain("Paused");
        } else {
          expect(options).toBeUndefined();
          expect(error).toContain("Paused after 3 consecutive");
        }
      }
    } finally {
      finishSpy.mockRestore();
    }
  });

  it("never lets a manual run count toward a pause", async () => {
    const usable = await usableCheck();
    const runHistory = await import("./run-history.js");
    const finishSpy = vi
      .spyOn(runHistory, "finishAutomationRun")
      .mockResolvedValue(undefined);
    try {
      usable.mockResolvedValueOnce(false);
      const automation = precondition("manual-check", {
        lastErrorCode: "missing_credentials",
        consecutiveFailures: 2,
      });
      await expect(
        runBackgroundAutomation(
          runOptions(automation, { manual: true }),
          standardDeps,
        ),
      ).rejects.toMatchObject({ errorCode: "missing_credentials" });
      const [, , error] = finishSpy.mock.calls[0]!;
      expect(error).not.toContain("Paused");
    } finally {
      finishSpy.mockRestore();
    }
  });
});

describe("runBackgroundAutomation — a failed run reports its own cause", () => {
  it("surfaces the run's error instead of 'ended with status: errored'", async () => {
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    const { EngineError } = await import("../agent/engine/types.js");
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
      async () => {
        throw new EngineError(
          "No LLM provider is connected. Open Settings > Agent > AI providers.",
          { errorCode: "missing_credentials" },
        );
      },
    );

    await expect(
      runBackgroundAutomation(
        runOptions(precondition("engine-credentials")),
        standardDeps,
      ),
    ).rejects.toMatchObject({
      errorCode: "missing_credentials",
      message: expect.stringContaining("No LLM provider is connected"),
    });
    const history = (await pglite
      .prepare(
        `SELECT error, error_code FROM automation_runs WHERE automation = ?`,
      )
      .get("engine-credentials")) as { error: string; error_code: string };
    expect(history.error_code).toBe("missing_credentials");
    expect(history.error).not.toContain("ended with status");
  });

  it("keeps a runtime error's real code and cause", async () => {
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    const { EngineError } = await import("../agent/engine/types.js");
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
      async () => {
        throw new EngineError("Gateway returned 502", {
          errorCode: "http_502",
        });
      },
    );

    await expect(
      runBackgroundAutomation(
        runOptions(precondition("engine-runtime")),
        standardDeps,
      ),
    ).rejects.toMatchObject({
      errorCode: "http_502",
      message: expect.stringContaining("Gateway returned 502"),
    });
  });

  it("tags the captured error with its code, owner kind and automation", async () => {
    const { registerErrorCaptureProvider } =
      await import("../server/capture-error.js");
    const captured: Array<{ context: Record<string, any> }> = [];
    const unregister = registerErrorCaptureProvider(
      "background-automation-outcome-spec",
      (_error, context) => {
        captured.push({ context: context as Record<string, any> });
        return undefined;
      },
    );
    const usable = await (async () => {
      const engineIndex = await import("../agent/engine/index.js");
      return vi.mocked(engineIndex.isResolvedEngineUsableForRequest);
    })();
    usable.mockResolvedValueOnce(false);
    try {
      await expect(
        runBackgroundAutomation(
          runOptions(precondition("tagged-failure")),
          standardDeps,
        ),
      ).rejects.toBeDefined();
    } finally {
      unregister();
    }

    expect(captured).toHaveLength(1);
    expect(captured[0]!.context.tags).toMatchObject({
      area: "background-automation",
      automation: "tagged-failure",
      errorCode: "missing_credentials",
      failureKind: "precondition",
      ownerKind: "user",
    });
    expect(captured[0]!.context.extra).toMatchObject({
      automationName: "tagged-failure",
      errorCode: "missing_credentials",
      consecutiveFailures: 1,
      paused: false,
    });
  });
});

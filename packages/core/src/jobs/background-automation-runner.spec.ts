import { afterAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { AgentEngine, EngineEvent } from "../agent/engine/types.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const rawClient = {
  transaction: pglite.transaction,
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
  return { ...actual, getDbExec: () => actual.getScopedDbExec() ?? rawClient };
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
  runAgentLoopDirectWithSoftTimeout: vi.fn(async (opts) => {
    opts.send?.({
      type: "tool_done",
      tool: "send-notification",
      result: "Sent",
      completedSideEffect: true,
    });
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: "test-model",
    };
  }),
}));

vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
  getThread: getThreadMock,
  updateThreadData: updateThreadDataMock,
  withThreadDataLock: async (_threadId: string, fn: () => Promise<unknown>) =>
    fn(),
}));

vi.mock("../agent/production-agent.js", () => ({
  appendAgentLoopContinuation: (messages: unknown[]) =>
    messages.push({
      role: "user",
      content: [{ type: "text", text: "Resume unfinished work." }],
    }),
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

describe("automation history ownership", () => {
  it.each([
    { owner: "alice@agent-native.test", scope: "personal", orgId: null },
    { owner: "__organization__:acme", scope: "organization", orgId: "acme" },
  ] as const)(
    "keeps scheduled and manual runs in $scope history",
    async ({ owner, scope, orgId }) => {
      const { startAutomationRun } = await import("./run-history.js");
      const { default: listRuns } =
        await import("./actions/list-automation-runs.js");
      const name = `ownership-${scope}`;
      const options = {
        automation: {
          name,
          meta: {
            schedule: "* * * * *",
            enabled: true,
            model: "test-model",
            orgId: "acme",
          },
          body: "Summarize the inbox.",
          resource: { owner, path: `jobs/${name}.md` } as any,
        },
        ownerEmail: "alice@agent-native.test",
        orgId: "acme",
        prompt: "Summarize the inbox.",
        threadTitle: `Job: ${name}`,
        runIdPrefix: name,
        usageLabel: `recurring-job:${name}`,
      };
      const deps = {
        getActions: () => ({}),
        getSystemPrompt: async () => "system",
        engine: testEngine,
        appId: "calendar",
      };
      await runBackgroundAutomation(options, deps);
      const historyId = await startAutomationRun({
        owner,
        automation: name,
        path: options.automation.resource.path,
        scope,
        orgId,
        appId: "calendar",
      });
      await runBackgroundAutomation(
        { ...options, historyId, manual: true },
        deps,
      );

      const ctx = {
        userEmail: options.ownerEmail,
        orgId: "acme",
        appId: "calendar",
      };
      const runs = await listRuns.run({ name, scope }, ctx);
      expect(runs).toHaveLength(2);
      for (const run of runs) {
        expect(run).toMatchObject({ owner, scope, orgId, status: "success" });
      }
      expect(runs.some((run) => run.id === historyId)).toBe(true);
      expect(
        await listRuns.run(
          { name, scope: scope === "personal" ? "organization" : "personal" },
          ctx,
        ),
      ).toEqual([]);
      expect(
        await listRuns.run(
          { name, scope },
          { ...ctx, userEmail: "bob@agent-native.test", orgId: "other" },
        ),
      ).toEqual([]);
    },
  );
});

describe("runBackgroundAutomation — confirmed work", () => {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model: "test-model",
  };

  it.each(["summary", "no-op", "progress-only"])(
    "includes predecessor work when recovery ends with %s",
    async (scenario) => {
      const runStore = await import("../agent/run-store.js");
      const history = await import("./run-history.js");
      const { runAgentLoopDirectWithSoftTimeout } =
        await import("../agent/run-loop-with-resume.js");
      const automation = precondition(`prior-work-${scenario}`);
      const threadId = `thread-prior-${scenario}`;
      const turnId = `turn-prior-${scenario}`;
      const historyId = await history.startAutomationRun({
        owner: automation.resource.owner,
        automation: automation.name,
        path: automation.resource.path,
        runId: "prior",
        threadId,
      });
      getThreadMock.mockResolvedValueOnce({
        id: threadId,
        title: "Interrupted",
        preview: "",
        messageCount: 1,
        threadData: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Send the report." }],
              metadata: { custom: { submittedTurnId: turnId } },
            },
          ],
        }),
      });
      const journal = vi
        .spyOn(runStore, "getCurrentTurnRunEventsForThread")
        .mockResolvedValue([
          {
            runId: "prior",
            seq: 0,
            event: { type: "tool_start", tool: "prior-action", input: {} },
          },
          {
            runId: "prior",
            seq: 1,
            event: {
              type: "tool_done",
              tool: "prior-action",
              result: "Sent",
              completedSideEffect: true,
            },
          },
        ]);
      const claim = vi
        .spyOn(runStore, "tryClaimRunSlot")
        .mockImplementation(async (id, runId, _staleMs, options) => {
          await runStore.insertRun(runId, id, options!.turnId!, {
            dispatchMode: "background",
            afterInsert: options!.afterInsert,
          });
          return { claimed: true, activeRunId: null };
        });
      vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
        async (opts) => {
          if (scenario === "no-op")
            await opts.actions["automation-no-op"].run({
              reason: "No remaining work.",
            });
          opts.send({ type: "text", text: "The prior send is complete." });
          return usage;
        },
      );
      try {
        const promise = runBackgroundAutomation(
          runOptions(automation, {
            historyId,
            resume: {
              historyId,
              threadId,
              turnId,
              previousRunId: "prior",
              hardDeadlineAt: Date.now() + 60_000,
            },
          }),
          {
            ...standardDeps,
            getActions: () => ({
              "prior-action": {
                run: vi.fn(),
                confirmsAutomationWork: scenario !== "progress-only",
              },
            }),
          },
        );
        if (scenario === "progress-only")
          await expect(promise).rejects.toMatchObject({
            errorCode: "automation_no_confirmed_work",
          });
        else {
          await expect(promise).resolves.toMatchObject({ status: "success" });
          expect(await history.getAutomationRun(historyId)).toMatchObject({
            status: "success",
          });
        }
      } finally {
        journal.mockRestore();
        claim.mockRestore();
      }
    },
  );

  it.each(["nothing-needed", "journal-no-op", "failed-send", "confirmed-work"])(
    "settles a declared no-op: %s",
    async (scenario) => {
      const { runAgentLoopDirectWithSoftTimeout } =
        await import("../agent/run-loop-with-resume.js");
      vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
        async (opts) => {
          expect(opts.systemPrompt).toContain("automation-no-op");
          if (scenario === "failed-send") {
            opts.send({
              type: "tool_done",
              tool: "send-digest",
              result: "HTTP 503: notification rejected",
              isError: true,
              errorCode: "http_503",
            });
          } else if (scenario === "confirmed-work") {
            opts.send({
              type: "tool_done",
              tool: "send-digest",
              result: "Sent",
              completedSideEffect: true,
            });
          }
          if (scenario === "journal-no-op") {
            opts.send({
              type: "tool_done",
              tool: "automation-no-op",
              result: JSON.stringify({
                status: "skipped",
                reason: "No urgent mail found.",
              }),
              replayed: true,
            });
          } else {
            const declaration = await opts.actions["automation-no-op"].run({
              reason: "No urgent mail found.",
            });
            expect(declaration).toEqual({
              status: "skipped",
              reason: "No urgent mail found.",
            });
          }
          opts.send({ type: "text", text: "No notification was sent." });
          return usage;
        },
      );
      const adapters = await import("../integrations/adapters/index.js");
      const sendMessageToTarget = vi.fn();
      const adapter = vi.spyOn(adapters, "getDefaultAdapter").mockReturnValue({
        formatAgentResponse: (text: string) => ({ text }),
        sendMessageToTarget,
      } as any);
      const name = `declared-no-op-${scenario}`;
      try {
        const run = runBackgroundAutomation(
          runOptions(
            precondition(
              name,
              scenario === "nothing-needed" || scenario === "journal-no-op"
                ? {
                    deliveryPlatform: "slack",
                    deliveryDestination: "example-channel",
                  }
                : {},
            ),
          ),
          { ...standardDeps, getInitialToolNames: () => ["list-events"] },
        );
        if (scenario === "failed-send") {
          await expect(run).rejects.toMatchObject({ errorCode: "http_503" });
        } else {
          await expect(run).resolves.toMatchObject({
            status: scenario === "confirmed-work" ? "success" : "skipped",
            ...(scenario !== "confirmed-work"
              ? { reason: "No urgent mail found." }
              : {}),
          });
        }
        expect(sendMessageToTarget).not.toHaveBeenCalled();
        expect(
          await pglite
            .prepare(
              "SELECT status, error FROM automation_runs WHERE automation = ?",
            )
            .get(name),
        ).toMatchObject({
          status:
            scenario === "nothing-needed" || scenario === "journal-no-op"
              ? "skipped"
              : scenario === "failed-send"
                ? "error"
                : "success",
          ...(scenario === "nothing-needed" || scenario === "journal-no-op"
            ? { error: "No urgent mail found." }
            : {}),
        });
      } finally {
        adapter.mockRestore();
      }
    },
  );

  it("rejects a no-op declaration without a reason", async () => {
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
      async (opts) => {
        await expect(
          opts.actions["automation-no-op"].run({ reason: "  " }),
        ).rejects.toThrow();
        return usage;
      },
    );
    await expect(
      runBackgroundAutomation(
        runOptions(precondition("invalid-no-op")),
        standardDeps,
      ),
    ).rejects.toMatchObject({ errorCode: "automation_no_confirmed_work" });
  });

  it.each([
    { trackProgress: false, status: 429 },
    { trackProgress: false, status: 503 },
    { trackProgress: true, status: 503 },
    { trackProgress: false, status: 200 },
    { trackProgress: false, status: 200, tool: "provider-api-request" },
  ])(
    "rejects a real HTTP $status send failure (progress bookkeeping: $trackProgress)",
    async ({ trackProgress, status, tool = "web-request" }) => {
      const { runAgentLoopDirectWithSoftTimeout } =
        await import("../agent/run-loop-with-resume.js");
      const { runAgentLoop: actualLoop } = await vi.importActual<
        typeof import("../agent/production-agent.js")
      >("../agent/production-agent.js");
      const { createFetchToolEntry } =
        await import("../extensions/fetch-tool.js");
      const { createProgressToolEntries } =
        await import("../progress/actions.js");
      const { createProviderApiRequestAction } =
        await import("../provider-api/actions/provider-api.js");
      let requests = 0;
      const engine: AgentEngine = {
        ...testEngine,
        capabilities: {
          thinking: false,
          promptCaching: false,
          vision: false,
          computerUse: false,
          parallelToolCalls: false,
        },
        async *stream(): AsyncIterable<EngineEvent> {
          if (requests++ === 0) {
            yield {
              type: "assistant-content",
              parts: [
                ...(trackProgress
                  ? [
                      {
                        type: "tool-call" as const,
                        id: "progress-1",
                        name: "manage-progress",
                        input: { action: "start", title: "Send weekly digest" },
                      },
                    ]
                  : []),
                {
                  type: "tool-call",
                  id: "send-1",
                  name: tool,
                  input:
                    tool === "provider-api-request"
                      ? {
                          provider: "slack",
                          path: "/chat.postMessage",
                          method: "POST",
                          body: { text: "Digest" },
                        }
                      : {
                          url:
                            status === 200
                              ? "https://slack.com/api/chat.postMessage"
                              : "https://93.184.216.34/digest",
                          method: "POST",
                          body: '{"text":"Digest"}',
                        },
                },
                ...(tool === "provider-api-request"
                  ? [
                      {
                        type: "tool-call" as const,
                        id: "no-op-1",
                        name: "automation-no-op",
                        input: { reason: "No notification was needed." },
                      },
                    ]
                  : []),
              ],
            };
            yield { type: "stop", reason: "tool_use" };
          } else {
            yield {
              type: "assistant-content",
              parts: [{ type: "text", text: "No notification was sent." }],
            };
            yield { type: "stop", reason: "end_turn" };
          }
        },
      };
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          status === 200
            ? JSON.stringify({ ok: false, error: "invalid_auth" })
            : "Delivery unavailable",
          {
            status,
            statusText: "Unavailable",
          },
        ),
      );
      vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
        actualLoop,
      );
      try {
        await expect(
          runBackgroundAutomation(
            runOptions(precondition("http-digest"), { manual: true }),
            {
              ...standardDeps,
              engine,
              getActions: () => ({
                ...createFetchToolEntry(),
                ...createProgressToolEntries(() => "alice@agent-native.test"),
                "provider-api-request": createProviderApiRequestAction({
                  executeRequest: async () => ({
                    response: {
                      ok: false,
                      status: 200,
                      json: { ok: false, error: "invalid_auth" },
                    },
                  }),
                }),
              }),
            },
          ),
        ).rejects.toMatchObject({
          errorCode:
            tool === "provider-api-request"
              ? "provider_api_rejected"
              : status === 200
                ? "web_request_provider_failed"
                : `http_${status}`,
          message: expect.stringContaining(`HTTP ${status}`),
        });
        expect(requests).toBe(2);
        expect(assistantContent()).toContainEqual(
          expect.objectContaining({
            type: "tool-call",
            toolName: tool,
          }),
        );
      } finally {
        fetchSpy.mockRestore();
      }
    },
  );

  it.each(["No notification was sent.", "Everything is complete."])(
    "rejects a prose-only finish: %s",
    async (text) => {
      const { runAgentLoopDirectWithSoftTimeout } =
        await import("../agent/run-loop-with-resume.js");
      vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
        async (opts) => {
          opts.send?.({ type: "text", text });
          return usage;
        },
      );
      await expect(
        runBackgroundAutomation(
          runOptions(precondition(`prose-only-${text.length}`)),
          standardDeps,
        ),
      ).rejects.toMatchObject({ errorCode: "automation_no_confirmed_work" });
    },
  );

  it.each(["delivered", "empty", "preparation", "failure", "action-only"])(
    "settles configured delivery: %s",
    async (scenario) => {
      const { runAgentLoopDirectWithSoftTimeout } =
        await import("../agent/run-loop-with-resume.js");
      const adapters = await import("../integrations/adapters/index.js");
      const sendMessageToTarget = vi.fn(async () => {
        if (scenario === "failure")
          throw Object.assign(new Error("Slack delivery rejected"), {
            errorCode: "http_503",
          });
      });
      const adapter = vi.spyOn(adapters, "getDefaultAdapter").mockReturnValue({
        formatAgentResponse: (text: string) => ({
          text,
          platformContext: {},
        }),
        sendMessageToTarget,
      } as any);
      vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
        async (opts) => {
          if (scenario === "preparation") {
            opts.send?.({ type: "text", text: "I will gather the digest." });
            opts.send?.({
              type: "tool_done",
              tool: "list-events",
              result: "[]",
            });
          } else if (scenario === "action-only") {
            opts.send?.({
              type: "tool_done",
              tool: "send-notification",
              result: "Sent",
              completedSideEffect: true,
            });
          } else if (scenario !== "empty") {
            opts.send?.({ type: "text", text: "Your weekly digest." });
          }
          return usage;
        },
      );
      try {
        const run = runBackgroundAutomation(
          runOptions(
            precondition(`delivery-${scenario}`, {
              deliveryPlatform: "slack",
              deliveryDestination: "example-channel",
            }),
          ),
          standardDeps,
        );
        if (scenario === "delivered" || scenario === "action-only") {
          await expect(run).resolves.toMatchObject({
            runId: expect.any(String),
          });
        } else {
          await expect(run).rejects.toMatchObject({
            errorCode:
              scenario === "failure"
                ? "http_503"
                : "automation_no_confirmed_work",
          });
          expect(assistantMessage().status).toMatchObject({
            type: "incomplete",
            reason: "error",
          });
        }
        expect(sendMessageToTarget).toHaveBeenCalledTimes(
          scenario === "delivered" || scenario === "failure" ? 1 : 0,
        );
      } finally {
        adapter.mockRestore();
      }
    },
  );

  it.each([false, true])(
    "rejects an undelivered digest (successful read: %s)",
    async (readSucceeded) => {
      const { runAgentLoopDirectWithSoftTimeout } =
        await import("../agent/run-loop-with-resume.js");
      vi.mocked(runAgentLoopDirectWithSoftTimeout).mockImplementationOnce(
        async (opts) => {
          if (readSucceeded)
            opts.send?.({
              type: "tool_done",
              tool: "list-events",
              result: "[]",
            });
          opts.send?.({
            type: "tool_done",
            tool: "send-digest",
            result: "Slack connection is unavailable",
            isError: true,
            completedSideEffect: false,
          });
          opts.send?.({ type: "text", text: "No notification was sent." });
          opts.send?.({ type: "done" });
          return {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: "test-model",
          };
        },
      );
      const name = `undelivered-digest-${readSucceeded}`;
      const options = {
        automation: {
          name,
          meta: { schedule: "* * * * *", enabled: true },
          body: "Send the Slack digest.",
          resource: {
            owner: "alice@agent-native.test",
            path: `jobs/${name}.md`,
          } as any,
        },
        ownerEmail: "alice@agent-native.test",
        prompt: "Send the Slack digest.",
        threadTitle: `Job: ${name}`,
        runIdPrefix: `job-${name}`,
        usageLabel: name,
        manual: true,
      };
      await expect(
        runBackgroundAutomation(options, {
          getActions: () => ({}),
          getSystemPrompt: async () => "system",
          engine: testEngine,
        }),
      ).rejects.toMatchObject({
        errorCode: "automation_no_confirmed_work",
        message: expect.stringContaining("Slack connection is unavailable"),
      });
      const row = (await pglite
        .prepare(
          "SELECT status, error_code, run_id FROM automation_runs WHERE automation = ?",
        )
        .get(name)) as { status: string; error_code: string; run_id: string };
      expect(row).toMatchObject({
        status: "error",
        error_code: "automation_no_confirmed_work",
      });
      expect(assistantMessage().status).toMatchObject({
        type: "incomplete",
        reason: "error",
      });
      const { getRun } = await import("../agent/run-manager.js");
      const coreRun = getRun(row.run_id)!;
      await coreRun.finalized;
      expect(coreRun.status).toBe("errored");
      expect(coreRun.events.at(-1)?.event).toMatchObject({
        type: "error",
        errorCode: "automation_no_confirmed_work",
      });
      expect(
        await pglite
          .prepare("SELECT status, error_code FROM agent_runs WHERE id = ?")
          .get(row.run_id),
      ).toMatchObject({
        status: "errored",
        error_code: "automation_no_confirmed_work",
      });
    },
  );
});

describe("default selection reaches new chats and background runs", () => {
  it("preserves app overrides on shared changes, honors app changes and resets only explicitly", async () => {
    const { registerAgentEngine, resolveEngine, getStoredModelForEngine } =
      await import("../agent/engine/index.js");
    const { unregisterAgentEngine } =
      await import("../agent/engine/registry.js");
    const {
      writeAgentAppModelDefaultSettings,
      resetAgentAppModelDefaultSettings,
    } = await import("../agent/app-model-defaults.js");
    const { selectDefaultAgentEngine } =
      await import("../scripts/agent-engines/set-agent-engine.js");
    const { run: manageEngine } =
      await import("../scripts/agent-engines/manage-agent-engine.js");
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    const ctx = { userEmail: "default-model@example.test" };
    const fakeEngine = {
      ...testEngine,
      name: "default-model-fixture",
      defaultModel: "claude-sonnet-5-5",
      supportedModels: ["claude-sonnet-5-5", "gpt-6-luna", "app-choice"],
    };
    registerAgentEngine({
      ...fakeEngine,
      label: "Fixture",
      description: "",
      capabilities: {},
      requiredEnvVars: [],
      create: () => fakeEngine,
    });
    try {
      await writeAgentAppModelDefaultSettings(ctx, "calendar", {
        engine: fakeEngine.name,
        model: "gpt-6-luna",
      });
      await runWithRequestContext(ctx, async () => {
        const engine = await resolveEngine({ appId: "calendar" });
        expect(
          await getStoredModelForEngine(engine, { appId: "calendar" }),
        ).toBe("gpt-6-luna");
        expect(
          await selectDefaultAgentEngine(
            {
              engine: fakeEngine.name,
              model: "claude-sonnet-5-5",
              appId: "calendar",
            },
            { actionName: "manage-agent-engine", caller: "tool" },
          ),
        ).toMatchObject({
          status: "selected",
          scope: "user",
          effective: { model: "gpt-6-luna", source: "app-default" },
        });
        const newChatEngine = await resolveEngine({ appId: "calendar" });
        expect(
          await getStoredModelForEngine(newChatEngine, { appId: "calendar" }),
        ).toBe("gpt-6-luna");
        const inheritingEngine = await resolveEngine({ appId: "mail" });
        expect(
          await getStoredModelForEngine(inheritingEngine, { appId: "mail" }),
        ).toBe("claude-sonnet-5-5");
        const changed = JSON.parse(
          await manageEngine({
            action: "set-app-default",
            appId: "calendar",
            engine: fakeEngine.name,
            model: "app-choice",
          }),
        );
        expect(changed).toMatchObject({
          requestedScope: "app",
          model: "app-choice",
        });
      });
      for (const pinned of [false, true]) {
        vi.mocked(runAgentLoopDirectWithSoftTimeout).mockClear();
        await runBackgroundAutomation(
          {
            automation: {
              name: "model-precedence",
              meta: {
                schedule: "* * * * *",
                enabled: true,
                ...(pinned ? { model: "gpt-6-luna" } : {}),
              },
              body: "Return a short status.",
              resource: {
                owner: ctx.userEmail,
                path: "jobs/model-precedence.md",
              } as any,
            },
            ownerEmail: ctx.userEmail,
            prompt: "Return a short status.",
            threadTitle: "Job: model precedence",
            runIdPrefix: `job-model-${pinned}`,
            usageLabel: "recurring-job:model-precedence",
          },
          {
            appId: "calendar",
            getActions: () => ({}),
            getSystemPrompt: async () => "system",
          },
        );
        expect(
          vi.mocked(runAgentLoopDirectWithSoftTimeout).mock.calls.at(-1)?.[0],
        ).toMatchObject({
          engine: { name: fakeEngine.name },
          model: pinned ? "gpt-6-luna" : "app-choice",
        });
      }
      await runWithRequestContext(ctx, async () => {
        const reset = JSON.parse(
          await manageEngine({
            action: "reset-app-default",
            appId: "calendar",
          }),
        );
        expect(reset).toMatchObject({
          requestedScope: "app",
          engine: null,
          model: null,
        });
        const inheritedEngine = await resolveEngine({ appId: "calendar" });
        expect(
          await getStoredModelForEngine(inheritedEngine, { appId: "calendar" }),
        ).toBe("claude-sonnet-5-5");
      });
    } finally {
      unregisterAgentEngine(fakeEngine.name);
      await resetAgentAppModelDefaultSettings(ctx, "calendar");
      const { deleteUserSetting } =
        await import("../settings/user-settings.js");
      await deleteUserSetting(ctx.userEmail, "agent-engine");
    }
  });
});

describe("runBackgroundAutomation — background-run self-claim", () => {
  it.each([
    { triggerType: undefined, manual: false, timezone: "America/New_York" },
    {
      triggerType: "schedule" as const,
      manual: false,
      timezone: "America/New_York",
    },
    {
      triggerType: "event" as const,
      manual: false,
      timezone: "America/New_York",
    },
    {
      triggerType: "webhook" as const,
      manual: false,
      timezone: "America/New_York",
    },
    {
      triggerType: "schedule" as const,
      manual: true,
      timezone: "America/New_York",
    },
    { triggerType: "schedule" as const, manual: false, timezone: undefined },
    { triggerType: "schedule" as const, manual: false, timezone: "not/a-zone" },
  ])(
    "gives $triggerType runs (manual=$manual, timezone=$timezone) chat's current date, time and timezone",
    async ({ triggerType, manual, timezone }) => {
      const { runAgentLoopDirectWithSoftTimeout } =
        await import("../agent/run-loop-with-resume.js");
      vi.mocked(runAgentLoopDirectWithSoftTimeout).mockClear();
      vi.stubEnv("TZ", "UTC");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-06T00:26:52Z"));

      try {
        await runBackgroundAutomation(
          {
            automation: {
              name: "clock-check",
              meta: {
                schedule: "*/2 * * * *",
                enabled: true,
                timezone,
                triggerType,
              },
              body: "Report the current time.",
              resource: {
                owner: "alice@agent-native.test",
                path: "jobs/clock-check.md",
              } as any,
            },
            ownerEmail: "alice@agent-native.test",
            prompt: "Report the current time.",
            threadTitle: "Job: clock-check",
            runIdPrefix: "job-clock-check",
            usageLabel: "clock-check",
            manual,
          },
          {
            getActions: () => ({}),
            getSystemPrompt: async () => {
              // Setup can take time; inject the clock when execution starts.
              vi.setSystemTime(new Date("2026-10-06T00:28:52Z"));
              return "system";
            },
            engine: testEngine,
          },
        );

        const input = vi
          .mocked(runAgentLoopDirectWithSoftTimeout)
          .mock.calls.at(-1)?.[0];
        const eastern = timezone === "America/New_York";
        const expectedTimezone = eastern ? "America/New_York" : "UTC";
        expect(input?.systemPrompt).toContain("currentDate: 2026-10-06");
        expect(input?.systemPrompt).toContain(
          `currentDateInTimezone: ${eastern ? "2026-10-05" : "2026-10-06"}`,
        );
        expect(input?.systemPrompt).toContain(
          `currentTimezone: ${expectedTimezone}`,
        );
        expect(input?.systemPrompt).toMatch(
          /^system[\s\S]*<\/runtime-context>$/,
        );
        expect(input?.systemPrompt).not.toContain("currentUtc:");
        expect(input?.messages[0].content).toEqual([
          {
            type: "text",
            text: expect.stringMatching(
              /^Report the current time\.[\s\S]*currentUtc: 2026-10-06T00:28:52\.000Z/,
            ),
          },
        ]);
        expect(JSON.stringify(input?.messages)).toContain(
          `currentTimezone: ${expectedTimezone}`,
        );
        expect(JSON.stringify(input?.messages)).toContain(
          eastern ? "8:28:52 PM EDT" : "12:28:52 AM UTC",
        );
      } finally {
        vi.useRealTimers();
        vi.unstubAllEnvs();
      }
    },
  );

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
        opts.send?.({
          type: "tool_done",
          tool: "send-notification",
          result: "Sent",
          completedSideEffect: true,
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

    expect(updateThreadDataMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(updateThreadDataMock.mock.calls[0]![1] as string).messages,
    ).toHaveLength(1);
    const [, threadData, title, , messageCount] =
      updateThreadDataMock.mock.calls.at(-1)!;
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
  it("saves the original prompt and attaches history before the worker claim", async () => {
    const history = await import("./run-history.js");
    const { getDbExec } = await import("../db/client.js");
    const originalAttach = history.attachAutomationRunThread;
    const historyId = await history.startAutomationRun({
      owner: "alice@agent-native.test",
      automation: "linked-admission",
      path: "jobs/linked-admission.md",
    });
    updateThreadDataMock.mockClear();
    const attach = vi
      .spyOn(history, "attachAutomationRunThread")
      .mockImplementation(async (historyId, threadId, runId, options) => {
        expect(updateThreadDataMock).toHaveBeenCalled();
        expect(JSON.stringify(updateThreadDataMock.mock.calls[0])).toContain(
          "Original admission request",
        );
        const worker = await getDbExec().execute({
          sql: "SELECT dispatch_mode FROM agent_runs WHERE id = ?",
          args: [runId],
        });
        expect(worker.rows[0]?.dispatch_mode).toBe("background");
        await originalAttach(historyId, threadId, runId, options);
      });
    try {
      await runBackgroundAutomation(
        runOptions(precondition("linked-admission"), {
          historyId,
          prompt: "Original admission request",
        }),
        standardDeps,
      );
      expect(attach).toHaveBeenCalledOnce();
    } finally {
      attach.mockRestore();
    }
  });

  it.each(["reassigned", "settled", "pre-claim failure"])(
    "does not start or finish a successor after its firing history is %s",
    async (state) => {
      const runStore = await import("../agent/run-store.js");
      const history = await import("./run-history.js");
      const { runAgentLoopDirectWithSoftTimeout } =
        await import("../agent/run-loop-with-resume.js");
      const automation = precondition(`history-race-${state}`);
      const threadId = `thread-history-race-${state}`;
      const turnId = `turn-history-race-${state}`;
      const historyId = await history.startAutomationRun({
        owner: automation.resource.owner,
        automation: automation.name,
        path: automation.resource.path,
        runId: "prior",
        threadId,
      });
      getThreadMock.mockResolvedValueOnce({
        id: threadId,
        title: "Interrupted",
        preview: "",
        messageCount: 1,
        threadData: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Original request" }],
              metadata: { custom: { submittedTurnId: turnId } },
            },
          ],
        }),
      });
      const journal = vi
        .spyOn(runStore, "getCurrentTurnRunEventsForThread")
        .mockImplementationOnce(async () => {
          if (state === "pre-claim failure")
            throw new Error("journal database temporarily unavailable");
          if (state === "reassigned")
            await history.attachAutomationRunThread(
              historyId,
              threadId,
              "live-successor",
            );
          else
            await history.finishAutomationRun(
              historyId,
              "error",
              "Already settled",
            );
          return [];
        });
      const claim = vi
        .spyOn(runStore, "tryClaimRunSlot")
        .mockImplementation(async (id, runId, _staleMs, options) => {
          await runStore.insertRun(runId, id, options!.turnId!, {
            dispatchMode: "background",
            afterInsert: options!.afterInsert,
          });
          return { claimed: true, activeRunId: null };
        });
      const turnRef = vi.spyOn(runStore, "getRunTurnRef");
      const evidence = vi.spyOn(runStore, "getCurrentTurnEventsForThread");
      if (state === "pre-claim failure") {
        turnRef.mockResolvedValueOnce({ threadId, turnId });
        evidence.mockImplementationOnce(async () => {
          await history.attachAutomationRunThread(
            historyId,
            threadId,
            "live-successor",
          );
          return [
            {
              type: "tool_done",
              tool: "send-test-email",
              result: "Sent",
              completedSideEffect: true,
            },
          ];
        });
      }
      const finish = vi.spyOn(history, "finishAutomationRun");
      vi.mocked(runAgentLoopDirectWithSoftTimeout).mockClear();
      try {
        await expect(
          runBackgroundAutomation(
            runOptions(automation, {
              historyId,
              resume: {
                historyId,
                threadId,
                turnId,
                previousRunId: "prior",
                hardDeadlineAt: Date.now() + 60_000,
              },
            }),
            standardDeps,
          ),
        ).rejects.toMatchObject({
          errorCode:
            state === "pre-claim failure"
              ? "background_automation_history_write_failed"
              : "background_automation_claim_lost",
        });
        expect(runAgentLoopDirectWithSoftTimeout).not.toHaveBeenCalled();
        expect(finish).toHaveBeenCalledTimes(state === "reassigned" ? 0 : 1);
        expect(await history.getAutomationRun(historyId)).toMatchObject({
          runId: state === "settled" ? "prior" : "live-successor",
          status: state === "settled" ? "error" : "running",
        });
        const workers = await pglite.query(
          `SELECT id FROM agent_runs WHERE turn_id = $1`,
          [turnId],
        );
        expect(workers.rows).toEqual([]);
      } finally {
        turnRef.mockRestore();
        evidence.mockRestore();
        journal.mockRestore();
        claim.mockRestore();
        finish.mockRestore();
      }
    },
  );

  it("leaves a resumed firing retryable when lease is lost at worker start", async () => {
    const runStore = await import("../agent/run-store.js");
    const history = await import("./run-history.js");
    const { AutomationSchedulerLeaseLostError } =
      await import("./scheduler-health.js");
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    const name = "resumed-worker-start";
    const threadId = `thread-lease-${name}`;
    const turnId = `turn-lease-${name}`;
    const historyId = `history-lease-${name}`;
    getThreadMock.mockResolvedValueOnce({
      id: threadId,
      title: "Interrupted",
      preview: "",
      messageCount: 1,
      threadData: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Original request" }],
            metadata: { custom: { submittedTurnId: turnId } },
          },
        ],
      }),
    });
    const journal = vi
      .spyOn(runStore, "getCurrentTurnRunEventsForThread")
      .mockResolvedValue([]);
    const claim = vi
      .spyOn(runStore, "tryClaimRunSlot")
      .mockImplementation(
        async (claimedThreadId, runId, _maxStaleMs, options) => {
          await runStore.insertRun(runId, claimedThreadId, options!.turnId!, {
            dispatchMode: "background",
            afterInsert: options!.afterInsert,
          });
          return { claimed: true, activeRunId: null };
        },
      );
    const attach = vi
      .spyOn(history, "attachAutomationRunThread")
      .mockResolvedValue(undefined);
    const finish = vi
      .spyOn(history, "finishAutomationRun")
      .mockResolvedValue(undefined);
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockClear();
    const options = runOptions(precondition(`lease-${name}`), {
      historyId,
      resume: {
        historyId: `history-lease-${name}`,
        threadId,
        turnId,
        previousRunId: `previous-${name}`,
        hardDeadlineAt: Date.now() + 60_000,
      },
      assertCanStart: async () => {
        throw new AutomationSchedulerLeaseLostError();
      },
    });
    try {
      await expect(
        runBackgroundAutomation(options, standardDeps),
      ).rejects.toMatchObject({
        errorCode: "automation_scheduler_lease_lost",
      });
      expect(finish).not.toHaveBeenCalled();
      expect(runAgentLoopDirectWithSoftTimeout).not.toHaveBeenCalled();
      const rows = (await pglite
        .prepare(
          "SELECT id, status, error_code FROM agent_runs WHERE turn_id = ?",
        )
        .all(turnId)) as Array<{
        id: string;
        status: string;
        error_code: string;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: "errored",
        error_code: "automation_scheduler_lease_lost",
      });
      expect(attach).toHaveBeenCalledWith(historyId, threadId, rows[0]!.id, {
        requirePersisted: true,
        expectedRunId: `previous-${name}`,
      });
      getThreadMock.mockResolvedValueOnce({
        id: threadId,
        title: "Interrupted",
        preview: "",
        messageCount: 1,
        threadData: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Original request" }],
              metadata: { custom: { submittedTurnId: turnId } },
            },
          ],
        }),
      });
      await runBackgroundAutomation(
        { ...options, assertCanStart: async () => {} },
        standardDeps,
      );
      expect(runAgentLoopDirectWithSoftTimeout).toHaveBeenCalledOnce();
      expect(finish).toHaveBeenCalledWith(
        historyId,
        "success",
        undefined,
        undefined,
        {
          notify: true,
          requirePersisted: true,
          expectedRunId: vi.mocked(runAgentLoopDirectWithSoftTimeout).mock
            .calls[0]![0].runId,
        },
      );
    } finally {
      journal.mockRestore();
      claim.mockRestore();
      attach.mockRestore();
      finish.mockRestore();
    }
  });

  it("keeps a newly committed firing retryable when its lease is already lost before worker setup", async () => {
    const history = await import("./run-history.js");
    const { inspectAutomationRecovery } =
      await import("./automation-recovery.js");
    const { AutomationSchedulerLeaseLostError } =
      await import("./scheduler-health.js");
    const { runAgentLoopDirectWithSoftTimeout } =
      await import("../agent/run-loop-with-resume.js");
    const automation = precondition("lease-before-new-worker");
    const lastRun = new Date().toISOString();
    const historyId = await history.startAutomationRun({
      owner: automation.resource.owner,
      automation: automation.name,
      path: automation.resource.path,
    });
    vi.mocked(runAgentLoopDirectWithSoftTimeout).mockClear();
    const options = runOptions(automation, {
      historyId,
      assertCanStart: async () => {
        throw new AutomationSchedulerLeaseLostError();
      },
    });
    await expect(
      runBackgroundAutomation(options, standardDeps),
    ).rejects.toMatchObject({
      errorCode: "automation_scheduler_lease_lost",
    });
    expect(runAgentLoopDirectWithSoftTimeout).not.toHaveBeenCalled();
    const stored = await history.getAutomationRun(historyId);
    expect(stored).toMatchObject({
      finishedAt: null,
      threadId: "thread-1",
      runId: expect.any(String),
    });
    const recovery = await inspectAutomationRecovery(
      automation.resource,
      {
        ...automation.meta,
        lastRun,
        lastStatus: "running",
        lastHistoryId: historyId,
      },
      new Date(),
    );
    expect(recovery).toMatchObject({
      state: "resume",
      resume: { historyId, previousRunId: stored!.runId },
    });
    if (recovery?.state !== "resume")
      throw new Error("Expected retryable firing");
    getThreadMock.mockResolvedValueOnce({
      id: stored!.threadId!,
      title: "Unstarted firing",
      preview: "",
      messageCount: 1,
      threadData: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: options.prompt }],
            metadata: { custom: { submittedTurnId: recovery.resume.turnId } },
          },
        ],
      }),
    });
    await runBackgroundAutomation(
      { ...options, resume: recovery.resume, assertCanStart: async () => {} },
      standardDeps,
    );
    expect(runAgentLoopDirectWithSoftTimeout).toHaveBeenCalledOnce();
    expect(await history.getAutomationRun(historyId)).toMatchObject({
      status: "success",
      threadId: stored!.threadId,
    });
  });

  it("settles an expired recovery deadline with its previous worker's journal evidence", async () => {
    const runStore = await import("../agent/run-store.js");
    const history = await import("./run-history.js");
    const finish = vi
      .spyOn(history, "finishAutomationRun")
      .mockResolvedValue(undefined);
    const ref = vi
      .spyOn(runStore, "getRunTurnRef")
      .mockResolvedValue({ threadId: "thread-1", turnId: "expired-turn" });
    const events = vi
      .spyOn(runStore, "getCurrentTurnEventsForThread")
      .mockResolvedValue([
        {
          type: "tool_done",
          tool: "send-test-email",
          id: "sent",
          result: "Delivered",
          completedSideEffect: true,
        },
      ]);
    try {
      await expect(
        runBackgroundAutomation(
          runOptions(precondition("expired-recovery"), {
            historyId: "expired-history",
            hardDeadlineAt: Date.now() - 1,
            resume: {
              historyId: "expired-history",
              threadId: "thread-1",
              turnId: "expired-turn",
              previousRunId: "expired-worker",
              hardDeadlineAt: Date.now() - 1,
            },
          }),
          standardDeps,
        ),
      ).rejects.toMatchObject({
        errorCode: "background_automation_hard_timeout",
        deliveryNote: expect.stringContaining("send-test-email"),
      });
      expect(finish).toHaveBeenCalledWith(
        "expired-history",
        "error",
        expect.stringContaining("send-test-email"),
        "background_automation_hard_timeout",
        expect.objectContaining({ requirePersisted: true }),
      );
      expect(await countRowsWithPrefix("job-expired-recovery")).toBe(0);
    } finally {
      finish.mockRestore();
      ref.mockRestore();
      events.mockRestore();
    }
  });

  it.each(["{}", "unreadable JSON"])(
    "does not replay the edited job when original recovery context is missing or unreadable (%s)",
    async (threadData) => {
      const runStore = await import("../agent/run-store.js");
      const history = await import("./run-history.js");
      const { runAgentLoopDirectWithSoftTimeout } =
        await import("../agent/run-loop-with-resume.js");
      vi.mocked(runAgentLoopDirectWithSoftTimeout).mockClear();
      getThreadMock.mockResolvedValueOnce({
        id: "thread-1",
        title: "Job",
        preview: "",
        threadData,
        messageCount: 0,
      });
      const spies = [
        vi.spyOn(runStore, "getRunTurnRef").mockResolvedValue({
          threadId: "thread-1",
          turnId: "crashed-turn",
        }),
        vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockResolvedValue([
          {
            type: "tool_done",
            tool: "send-test-email",
            id: "sent-email",
            result: "Delivered",
            completedSideEffect: true,
          },
        ]),
        vi.spyOn(history, "finishAutomationRun").mockResolvedValue(undefined),
      ];
      try {
        await expect(
          runBackgroundAutomation(
            runOptions(precondition("missing-original"), {
              historyId: "crashed-history",
              resume: {
                historyId: "crashed-history",
                threadId: "thread-1",
                turnId: "crashed-turn",
                previousRunId: "crashed-worker",
                hardDeadlineAt: Date.now() + 60_000,
              },
            }),
            standardDeps,
          ),
        ).rejects.toBeDefined();
        expect(runAgentLoopDirectWithSoftTimeout).not.toHaveBeenCalled();
        expect(await countRowsWithPrefix("job-missing-original")).toBe(0);
        expect(history.finishAutomationRun).toHaveBeenCalledWith(
          "crashed-history",
          "error",
          expect.stringContaining(
            "Completed steps confirmed by the run journal: send-test-email",
          ),
          expect.any(String),
          expect.objectContaining({ requirePersisted: true }),
        );
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    },
  );

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

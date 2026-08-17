import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

/**
 * `runBackgroundAutomation` executes entirely in-process — there is no HTTP
 * self-dispatch to a separate worker — yet it marks its run row
 * `dispatch_mode = 'background'` so the reaper gives it the wider
 * background stale window. Without an immediate self-claim, that row sits at
 * the transient 'background' state for its WHOLE life: the unclaimed-
 * background-run sweep (run-store.ts's `listUnclaimedBackgroundRunRows` /
 * `reapUnclaimedBackgroundRun`) treats ANY such row past the 25s grace window
 * as a dead HTTP handoff and errors it mid-run with
 * `background_worker_never_started`, even though the job is still executing.
 * This pins the fix: the row must land on `background-processing` — the SAME
 * claimed state a genuine HTTP background worker reaches via
 * `claimBackgroundRun` — which removes it from that sweep's eligibility (it
 * filters on `dispatch_mode = 'background'` exactly, not a LIKE prefix).
 *
 * Real SQLite (not a blanket mock) so the CAS UPDATE semantics in
 * `claimBackgroundRun` / `insertRun`'s `ON CONFLICT DO NOTHING` are exercised
 * for real, matching the convention in durable-background-fallback.spec.ts.
 */

const sqlite = new Database(":memory:");

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      sqlite.exec(input);
      return { rows: [] as unknown[], rowsAffected: 0 };
    }
    const stmt = sqlite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: stmt.all(...args), rowsAffected: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [] as unknown[], rowsAffected: info.changes };
  }),
};

// Partial-mock: only getDbExec is replaced (with the real-SQLite client
// above); every other export (getDialect, intType, isPostgres,
// retryOnDdlRace, ...) stays real, since several transitively-imported
// modules (secrets/storage.ts, db/schema.ts) call those directly.
vi.mock(import("../db/client.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getDbExec: () => rawClient };
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
  createThread: vi.fn(async () => ({ id: "thread-1" })),
}));

// Narrow re-implementation, not `vi.importActual` — pulling in the real
// production-agent.ts module graph pulls in its module-scope engine
// registration, which this focused test doesn't need (see the same note in
// scheduler.spec.ts).
vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: () => [],
  filterInitialEngineTools: (tools: unknown[]) => tools,
  getOwnerActiveApiKey: vi.fn(async () => null),
  runAgentLoop: vi.fn(),
}));

// The credential store answers "no rows" cleanly. A Builder-credits site has no
// per-user connection to find, which is exactly the case the engine capture
// below has to survive.
vi.mock("../secrets/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../secrets/storage.js")>()),
  readAppSecret: vi.fn(async () => null),
  readAppSecrets: vi.fn(async () => new Map()),
}));

const { BACKGROUND_RUN_HARD_TIMEOUT_MS, runBackgroundAutomation } =
  await import("./background-automation-runner.js");

function dispatchModeOf(runId: string): string | null {
  const row = sqlite
    .prepare(`SELECT dispatch_mode FROM agent_runs WHERE id = ?`)
    .get(runId) as { dispatch_mode: string | null } | undefined;
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

    expect(dispatchModeOf(runId)).toBe("background-processing");
  });

  // Without `backgroundFunction`, scheduled work inherits the interactive
  // regime — a 40s soft timeout, a no-progress backstop at 0.75x that, and 6
  // continuations. The backstop is suspended while a tool is in flight but not
  // between tools, so a legitimate multi-minute job dies in the first >30s gap
  // and is recorded as `no_progress` after minutes of real work. It was the
  // largest single terminal reason across the fleet's scheduled runs.
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
    });
    expect(call?.[2]).toMatchObject({ backgroundFunction: true });
  });
  // History is a record ABOUT the run. If the history table is unwritable the
  // correct outcome is a missing record, not a scheduled automation that never
  // executed and gets reported as a failure.
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
      // Nothing to attach or finish once the record could not be opened.
      expect(attachSpy).not.toHaveBeenCalled();
      expect(finishSpy).not.toHaveBeenCalled();
    } finally {
      startSpy.mockRestore();
      attachSpy.mockRestore();
      finishSpy.mockRestore();
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

      // The capture is only correct if a turn taken later, detached from this
      // stack, actually authenticates. A captured identity-lane result yields
      // missing_credentials here and never reaches fetch.
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

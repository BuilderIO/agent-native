import { beforeEach, describe, expect, it, vi } from "vitest";

import * as runHistory from "./run-history.js";
import { processRecurringJobs, runJobNow } from "./scheduler.js";

const resourceListAllOwnersMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const createThreadMock = vi.hoisted(() => vi.fn());
const runAgentLoopMock = vi.hoisted(() => vi.fn());
const runAgentLoopWrapperMock = vi.hoisted(() => vi.fn());
const startRunMock = vi.hoisted(() => vi.fn());
const recordUsageMock = vi.hoisted(() => vi.fn());
const dbExecuteMock = vi.hoisted(() => vi.fn());
const getDbExecMock = vi.hoisted(() => vi.fn());

vi.mock("../agent/run-loop-with-resume.js", () => ({
  runAgentLoopDirectWithSoftTimeout: runAgentLoopWrapperMock,
}));

vi.mock("../resources/store.js", () => ({
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? owner.slice("__organization__:".length)
      : null,
  resourceListAllOwners: resourceListAllOwnersMock,
  resourcePut: resourcePutMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
  resourceGetByPath: resourceGetByPathMock,
  resourceGet: vi.fn(),
}));

vi.mock("../resources/emitter.js", () => ({
  getResourcesEmitter: () => ({ on: vi.fn() }),
}));

vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
  getThread: vi.fn(async () => ({
    id: "thread-1",
    title: "Job",
    preview: "",
    threadData: "{}",
    messageCount: 0,
  })),
  updateThreadData: vi.fn(async () => {}),
  withThreadDataLock: async (_id: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: vi.fn(() => []),
  getOwnerActiveApiKey: vi.fn(async () => "test-api-key"),
  resolveOwnerEngineApiKey: vi.fn(async () => ({
    apiKey: undefined,
    apiKeyEnvVar: undefined,
  })),
  runAgentLoop: runAgentLoopMock,
  filterInitialEngineTools: (tools: unknown[]) => tools,
}));

vi.mock("../agent/run-manager.js", () => ({
  resolveRunSoftTimeoutMs: vi.fn(() => 0),
  resolveBackgroundAutomationSoftTimeoutMs: vi.fn(() => 0),
  resolveBackgroundRunHardTimeoutMs: vi.fn(() => 10 * 60_000),
  startRun: startRunMock,
}));

vi.mock("../usage/store.js", () => ({
  recordUsage: recordUsageMock,
}));

vi.mock("./remote-execution.js", () => ({
  dispatchRemoteAutomation: vi.fn(),
  finishRemoteAutomationHistory: vi.fn(),
  getRemoteAutomationStatus: vi.fn(async () => ({ state: "not-remote" })),
}));

vi.mock("./scheduler-health.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scheduler-health.js")>();
  return { ...actual, recordAutomationSchedulerHealth: vi.fn(async () => {}) };
});

vi.mock("../integrations/adapters/index.js", () => ({
  getDefaultAdapter: () => ({
    formatAgentResponse: (text: string) => ({ text, platformContext: {} }),
    sendMessageToTarget: vi.fn(),
  }),
}));

vi.mock("../server/onboarding-html.js", () => ({
  getOnboardingHtml: vi.fn(),
  getResetPasswordHtml: vi.fn(),
}));

vi.mock(import("../db/client.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getDbExec: getDbExecMock };
});

const testEngine = {
  name: "test",
  defaultModel: "test-model",
  supportedModels: ["test-model"],
} as any;

describe("stale automation run-lock recovery across trigger types", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbExecuteMock.mockResolvedValue({ rows: [{ "1": 1 }], rowsAffected: 1 });
    getDbExecMock.mockReturnValue({ execute: dbExecuteMock });
    resourcePutMock.mockResolvedValue(undefined);
    resourcePutIfCurrentMock.mockImplementation(
      async (input: { owner: string; path: string; content: string }) => {
        await resourcePutMock(input.owner, input.path, input.content);
        return { id: input.owner + input.path };
      },
    );
    resourceGetByPathMock.mockImplementation(
      async (owner: string, path: string) => {
        const latestListCall = resourceListAllOwnersMock.mock.results.at(-1);
        const listedResources = latestListCall?.value
          ? await latestListCall.value
          : [];
        const listed = listedResources.find(
          (resource: { owner: string; path: string }) =>
            resource.owner === owner && resource.path === path,
        );
        const written = resourcePutMock.mock.calls
          .filter((call) => call[0] === owner && call[1] === path)
          .at(-1);
        return written
          ? { id: listed?.id ?? "resource-1", owner, path, content: written[2] }
          : (listed ?? null);
      },
    );
    createThreadMock.mockResolvedValue({ id: "thread-1" });
    runAgentLoopMock.mockResolvedValue({
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      model: "test-model",
    });
    runAgentLoopWrapperMock.mockImplementation((opts: unknown) =>
      runAgentLoopMock(opts),
    );
    startRunMock.mockImplementation(
      (
        runId: string,
        threadId: string,
        runFn: (
          send: (event: unknown) => void,
          signal: AbortSignal,
        ) => Promise<void>,
        onComplete?: (run: { status: string }) => void | Promise<void>,
      ) => {
        const abort = new AbortController();
        const activeRun = { runId, threadId, status: "running", abort };
        void Promise.resolve().then(async () => {
          try {
            await runFn(vi.fn(), abort.signal);
            activeRun.status = "completed";
          } catch {
            activeRun.status = "errored";
          }
          await onComplete?.(activeRun);
        });
        return activeRun;
      },
    );
    recordUsageMock.mockResolvedValue(undefined);
  });

  it("resets a stuck event automation with no cron schedule, not just cron jobs", async () => {
    const stuckLastRun = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const stuckContent = [
      "---",
      'schedule: ""',
      "enabled: true",
      "createdBy: alice+jobs@agent-native.test",
      "triggerType: event",
      "event: order.created",
      "deliveryPlatform: slack",
      "deliveryDestination: C0123456",
      "lastStatus: running",
      "lastRun: " + stuckLastRun,
      "---",
      "",
      "Summarize the new order and post it to Slack.",
    ].join("\n");

    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-stuck-event",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/slack-support.md",
        content: stuckContent,
      },
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(createThreadMock).not.toHaveBeenCalled();
    expect(runAgentLoopMock).not.toHaveBeenCalled();

    expect(resourcePutMock).toHaveBeenCalledOnce();
    const putCall = resourcePutMock.mock.calls[0][1];
    expect(putCall).toBe("jobs/slack-support.md");
    const putContent = resourcePutMock.mock.calls[0][2];
    expect(putContent).toContain("lastStatus: error");
    expect(putContent).toContain("timed out or been recycled");

    const unlockedResource = {
      id: "resource-stuck-event",
      owner: "alice+jobs@agent-native.test",
      path: "jobs/slack-support.md",
      updatedAt: "2026-08-04T00:00:00.000Z",
      content: putContent,
    };
    resourceGetByPathMock.mockResolvedValueOnce(unlockedResource);

    const result = await runJobNow(unlockedResource.owner, "slack-support", {
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(result.status).not.toBe("skipped");
    expect(runAgentLoopMock).toHaveBeenCalledOnce();
  });

  it("does not touch automation history when the stale-lock reset loses its CAS", async () => {
    const stuckLastRun = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const stuckContent = [
      "---",
      'schedule: ""',
      "enabled: true",
      "createdBy: alice+jobs@agent-native.test",
      "triggerType: event",
      "event: order.created",
      "lastStatus: running",
      "lastRun: " + stuckLastRun,
      "---",
      "",
      "Do the thing.",
    ].join("\n");

    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-race",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/race.md",
        content: stuckContent,
      },
    ]);
    resourcePutIfCurrentMock.mockResolvedValueOnce(null);
    const listAutomationRunsSpy = vi.spyOn(runHistory, "listAutomationRuns");

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(listAutomationRunsSpy).not.toHaveBeenCalled();
  });

  function staleHistoryJob() {
    const stuckLastRun = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    return {
      id: "resource-stale-history",
      owner: "alice+jobs@agent-native.test",
      path: "jobs/slack-support.md",
      content: [
        "---",
        'schedule: "* * * * *"',
        'nextRun: "1970-01-01T00:00:00.000Z"',
        "enabled: true",
        "createdBy: alice+jobs@agent-native.test",
        "lastStatus: running",
        "lastRun: " + stuckLastRun,
        "---",
        "",
        "Summarize the new order and post it to Slack.",
      ].join("\n"),
    };
  }

  function historyRow(
    id: string,
    startedAt: number,
    options: { claimedAt?: number | null; dispatchPending?: boolean } = {},
  ) {
    return {
      id,
      owner: "alice+jobs@agent-native.test",
      automation: "slack-support",
      path: "jobs/slack-support.md",
      scope: "personal",
      org_id: null,
      app_id: null,
      run_id: null,
      thread_id: null,
      status: "running",
      started_at: startedAt,
      finished_at: null,
      error: null,
      error_code: null,
      notification_email: null,
      dispatch_pending: options.dispatchPending === true ? 1 : 0,
      claimed_at: options.claimedAt ?? null,
    };
  }

  /** The terminal writes `finishAutomationRun` issues, keyed by run id. */
  function routeHistoryDb(
    rows: Array<Record<string, unknown>>,
    options: { failFirstFinish?: boolean } = {},
  ): Array<{
    id: string;
    status: string;
    errorCode: string | null;
  }> {
    const finishes: Array<{
      id: string;
      status: string;
      errorCode: string | null;
    }> = [];
    let finishAttempts = 0;
    dbExecuteMock.mockImplementation(
      async (query: { sql?: string; args?: unknown[] }) => {
        const sql = query.sql ?? "";
        if (sql.includes("SELECT * FROM automation_runs WHERE owner IN")) {
          const limit = Number(/LIMIT\s+(\d+)/i.exec(sql)?.[1] ?? rows.length);
          return { rows: rows.slice(0, limit), rowsAffected: 0 };
        }
        if (sql.includes("FROM automation_runs WHERE id = ?")) {
          const id = String(query.args?.[0] ?? "");
          return { rows: rows.filter((row) => row.id === id), rowsAffected: 0 };
        }
        if (
          sql.startsWith("UPDATE automation_runs") &&
          sql.includes("SET status = ?")
        ) {
          finishAttempts += 1;
          if (options.failFirstFinish && finishAttempts === 1) {
            throw new Error("history write failed");
          }
          const [status, , , errorCode, , , id] = query.args ?? [];
          finishes.push({
            id: String(id),
            status: String(status),
            errorCode: errorCode == null ? null : String(errorCode),
          });
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [{ "1": 1 }], rowsAffected: 1 };
      },
    );
    return finishes;
  }

  it("still records the stopped run itself when the stale-lock resets", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([staleHistoryJob()]);
    const finishes = routeHistoryDb([
      historyRow("run-stopped", Date.now() - 11 * 60 * 1000),
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(finishes).toEqual([
      {
        id: "run-stopped",
        status: "error",
        errorCode: "background_automation_interrupted",
      },
    ]);
  });

  it("settles the stopped run without touching a newer queued run", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([staleHistoryJob()]);
    const finishes = routeHistoryDb([
      historyRow("run-queued-now", Date.now() - 30_000, {
        dispatchPending: true,
      }),
      historyRow("run-stopped", Date.now() - 11 * 60 * 1000),
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(finishes).toEqual([
      {
        id: "run-stopped",
        status: "error",
        errorCode: "background_automation_interrupted",
      },
    ]);
    expect(resourcePutMock).toHaveBeenCalledOnce();
    expect(resourcePutMock.mock.calls[0][2]).toContain("lastStatus: error");
  });

  it("keeps a queued dispatch inside its claim lease and closes one past it", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([staleHistoryJob()]);
    const finishes = routeHistoryDb([
      // Started 20 minutes ago, so it lists as `interrupted`, but claimed a
      // minute ago: the stored claim, not the derived status, must protect it.
      historyRow("run-claimed-recently", Date.now() - 20 * 60 * 1000, {
        dispatchPending: true,
        claimedAt: Date.now() - 60_000,
      }),
      // Never claimed, older than the 15-minute claim lease: stuck queue entry.
      historyRow("run-queued-too-long", Date.now() - 16 * 60 * 1000, {
        dispatchPending: true,
      }),
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(finishes).toEqual([
      {
        id: "run-queued-too-long",
        status: "error",
        errorCode: "background_automation_interrupted",
      },
    ]);
  });

  it("settles every stopped run, not just the first batch", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([staleHistoryJob()]);
    const stoppedAt = Date.now() - 11 * 60 * 1000;
    const finishes = routeHistoryDb([
      historyRow("run-queued-now", Date.now() - 30_000, {
        dispatchPending: true,
      }),
      ...Array.from({ length: 21 }, (_, index) =>
        historyRow(`run-stopped-${index}`, stoppedAt),
      ),
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(finishes.map((finish) => finish.id)).toEqual(
      Array.from({ length: 21 }, (_, index) => `run-stopped-${index}`),
    );
  });

  it("keeps settling later runs when one history write fails", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([staleHistoryJob()]);
    const stoppedAt = Date.now() - 11 * 60 * 1000;
    const finishes = routeHistoryDb(
      [
        historyRow("run-stopped-1", stoppedAt),
        historyRow("run-stopped-2", stoppedAt),
      ],
      { failFirstFinish: true },
    );

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(finishes.map((finish) => finish.id)).toEqual(["run-stopped-2"]);
  });
});

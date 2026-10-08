import { AsyncLocalStorage } from "node:async_hooks";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeProgressRunMock, getProgressRunMock, insertNotificationMock } =
  vi.hoisted(() => ({
    completeProgressRunMock: vi.fn(),
    getProgressRunMock: vi.fn(),
    insertNotificationMock: vi.fn(),
  }));

let queueRows: Record<string, any>[] = [];
let failNextDispatchStateRead = false;
let reclaimAfterNextDispatchStateRead = false;
let failParentCompletionReadFor: string | null = null;
let rejectNextThreadDataUpdate = false;
let transactionTail: Promise<void> = Promise.resolve();
const transactionContext = new AsyncLocalStorage<{ aborted: boolean }>();
function affected(n: number) {
  return { rows: [], rowsAffected: n };
}
const queueDb = {
  execute: vi.fn(async (q: string | { sql: string; args?: any[] }) => {
    const s = (typeof q === "string" ? q : q.sql).replace(/\s+/g, " ").trim();
    const args = typeof q === "string" ? [] : (q.args ?? []);
    if (transactionContext.getStore()?.aborted) {
      throw new Error("current transaction is aborted");
    }
    if (s.includes("CREATE TABLE") || s.includes("CREATE INDEX"))
      return affected(0);
    if (s.includes("INSERT INTO agent_team_run_queue")) {
      queueRows.push({
        task_id: args[0],
        thread_id: args[1],
        run_id: args[2],
        status: "queued",
        owner_email: args[3] ?? null,
        org_id: args[4] ?? null,
        payload: args[5],
        continuation_count: 0,
        attempts: 0,
        created_at: args[6],
        updated_at: args[7],
        reconciliation_attempted_at: null,
      });
      return affected(1);
    }
    if (s.includes("SET reconciliation_attempted_at = ?")) {
      const [attemptedAt, taskId, updatedBefore, attemptedBefore] = args;
      const row = queueRows.find((candidate) => candidate.task_id === taskId);
      if (
        row &&
        row.owner_email &&
        (row.status === "queued" || row.status === "running") &&
        row.updated_at <= updatedBefore &&
        (row.reconciliation_attempted_at === null ||
          row.reconciliation_attempted_at === undefined ||
          row.reconciliation_attempted_at <= attemptedBefore)
      ) {
        row.reconciliation_attempted_at = attemptedAt;
        return affected(1);
      }
      return affected(0);
    }
    if (s.includes("SET status = 'running', attempts = attempts + 1")) {
      const [updatedAt, taskId, stuckCutoff] = args;
      const r = queueRows.find((x) => x.task_id === taskId);
      if (
        r &&
        (r.status === "queued" ||
          (r.status === "running" && r.updated_at < stuckCutoff))
      ) {
        r.status = "running";
        r.attempts += 1;
        r.updated_at = updatedAt;
        return affected(1);
      }
      return affected(0);
    }
    if (s.includes("continuation_count = continuation_count + 1")) {
      const [nextStatus, updatedAt, taskId, claimedAttempts] = args;
      const r = queueRows.find(
        (x) =>
          x.task_id === taskId &&
          x.status === "running" &&
          (claimedAttempts === undefined || x.attempts === claimedAttempts),
      );
      if (r) {
        r.continuation_count += 1;
        r.status = nextStatus;
        r.updated_at = updatedAt;
        return affected(1);
      }
      return affected(0);
    }
    if (s.includes("SET status = 'queued', updated_at = ?")) {
      const [updatedAt, taskId, claimedAttempts] = args;
      const row = queueRows.find(
        (candidate) =>
          candidate.task_id === taskId &&
          candidate.status === "running" &&
          candidate.attempts === claimedAttempts,
      );
      if (!row) return affected(0);
      row.status = "queued";
      row.updated_at = updatedAt;
      return affected(1);
    }
    if (s.includes("AND status = ? AND attempts = ? AND updated_at = ?")) {
      const [status, updatedAt, taskId, expectedStatus, attempts, expectedAt] =
        args;
      const row = queueRows.find((candidate) => candidate.task_id === taskId);
      if (
        row &&
        row.status === expectedStatus &&
        row.attempts === attempts &&
        row.updated_at === expectedAt
      ) {
        row.status = status;
        row.updated_at = updatedAt;
        return affected(1);
      }
      return affected(0);
    }
    if (s.includes("SET status = ?, updated_at = ?")) {
      const [status, updatedAt, taskId, claimedAttempts] = args;
      const r = queueRows.find(
        (x) =>
          x.task_id === taskId &&
          (claimedAttempts === undefined || x.attempts === claimedAttempts) &&
          (!s.includes(
            "AND status IN ('queued', 'running') AND attempts = ?",
          ) ||
            x.status === "running" ||
            x.status === "queued"),
      );
      if (r) {
        r.status = status;
        r.updated_at = updatedAt;
        return affected(1);
      }
      return affected(0);
    }
    if (
      s.includes("SET updated_at = ? WHERE task_id = ? AND status = 'running'")
    ) {
      const [updatedAt, taskId, claimedAttempts] = args;
      const r = queueRows.find(
        (x) =>
          x.task_id === taskId &&
          x.status === "running" &&
          (claimedAttempts === undefined || x.attempts === claimedAttempts),
      );
      if (r) {
        r.updated_at = updatedAt;
        return affected(1);
      }
      return affected(0);
    }
    if (s.includes("SELECT continuation_count")) {
      const r = queueRows.find((x) => x.task_id === args[0]);
      return {
        rows: r ? [{ continuation_count: r.continuation_count }] : [],
        rowsAffected: 0,
      };
    }
    if (
      s.includes(
        "SELECT status, attempts, updated_at FROM agent_team_run_queue",
      )
    ) {
      const r = queueRows.find((x) => x.task_id === args[0]);
      return {
        rows: r
          ? [
              {
                status: r.status,
                attempts: r.attempts,
                updated_at: r.updated_at,
              },
            ]
          : [],
        rowsAffected: 0,
      };
    }
    if (s.includes("SELECT task_id FROM agent_team_run_queue")) {
      return {
        rows: queueRows
          .filter(
            (x) =>
              x.owner_email === args[0] &&
              (x.status === "queued" || x.status === "running"),
          )
          .map((x) => ({ task_id: x.task_id })),
        rowsAffected: 0,
      };
    }
    if (
      s.includes(
        "SELECT task_id, owner_email, org_id FROM agent_team_run_queue",
      )
    ) {
      const [updatedBefore, attemptedBefore, limit] = args;
      return {
        rows: queueRows
          .filter(
            (x) =>
              x.owner_email !== null &&
              (x.status === "queued" || x.status === "running") &&
              x.updated_at <= updatedBefore &&
              (x.reconciliation_attempted_at === null ||
                x.reconciliation_attempted_at === undefined ||
                x.reconciliation_attempted_at <= attemptedBefore),
          )
          .sort((a, b) => {
            const aAttempt = a.reconciliation_attempted_at;
            const bAttempt = b.reconciliation_attempted_at;
            return (
              (aAttempt ?? a.updated_at) - (bAttempt ?? b.updated_at) ||
              a.updated_at - b.updated_at ||
              String(a.task_id).localeCompare(String(b.task_id))
            );
          })
          .slice(0, limit)
          .map((x) => ({
            task_id: x.task_id,
            owner_email: x.owner_email,
            org_id: x.org_id,
          })),
        rowsAffected: 0,
      };
    }
    if (s.includes("SELECT * FROM agent_team_run_queue WHERE task_id = ?")) {
      if (failNextDispatchStateRead) {
        failNextDispatchStateRead = false;
        throw new Error("dispatch state read unavailable");
      }
      const r = queueRows.find((x) => x.task_id === args[0]);
      const rows = r ? [{ ...r }] : [];
      if (reclaimAfterNextDispatchStateRead) {
        reclaimAfterNextDispatchStateRead = false;
        await queue.claimAgentTeamRun(String(args[0]));
      }
      return { rows, rowsAffected: 0 };
    }
    return affected(0);
  }),
  transaction: vi.fn(async <T>(fn: (tx: any) => Promise<T>) => {
    const previousTransaction = transactionTail;
    let releaseTransaction!: () => void;
    transactionTail = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    await previousTransaction;
    const rowsBeforeTransaction = structuredClone(queueRows);
    const context = { aborted: false };
    try {
      return await transactionContext.run(context, async () => {
        const value = await fn(queueDb);
        if (context.aborted) {
          throw new Error("current transaction is aborted");
        }
        return value;
      });
    } catch (error) {
      queueRows = rowsBeforeTransaction;
      throw error;
    } finally {
      releaseTransaction();
    }
  }),
};
vi.mock("../db/client.js", () => ({
  getDbExec: () => queueDb,
  withDbExec: (_exec: unknown, fn: () => unknown) => fn(),
  describeDbError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  retryOnDdlRace: (fn: () => unknown) => fn(),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

const appState = new Map<string, any>();
type MockRequestContext = {
  userEmail?: string;
  orgId?: string;
  run?: { allowedActionNames?: readonly string[] };
};
const requestContexts: MockRequestContext[] = [];
let activeRequestContext: MockRequestContext | undefined;

function requireMockRequestContext(): void {
  if (!activeRequestContext?.userEmail) {
    throw new Error("missing mock request context");
  }
}

vi.mock("../application-state/script-helpers.js", () => ({
  readAppState: vi.fn(async (k: string) => {
    requireMockRequestContext();
    const value = appState.get(k);
    return value == null ? null : structuredClone(value);
  }),
  writeAppState: vi.fn(async (k: string, v: any) => {
    requireMockRequestContext();
    appState.set(k, structuredClone(v));
  }),
  deleteAppState: vi.fn(async (k: string) => {
    requireMockRequestContext();
    return appState.delete(k);
  }),
  listAppState: vi.fn(async (prefix: string) => {
    requireMockRequestContext();
    if (failParentCompletionReadFor === prefix) {
      failParentCompletionReadFor = null;
      throw new Error("parent completion state unavailable");
    }
    return [...appState.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ key: k, value: structuredClone(v) }));
  }),
}));

const threadData = new Map<string, string>();
vi.mock("../chat-threads/store.js", () => ({
  createThread: vi.fn(async (_owner: string, opts: any) => ({
    id: "thread-1",
    title: opts?.title ?? "",
  })),
  getThread: vi.fn(async (id: string) => ({
    id,
    threadData: threadData.get(id) ?? null,
    ownerEmail: "owner@example.com",
  })),
  updateThreadData: vi.fn(async (id: string, data: string) => {
    if (rejectNextThreadDataUpdate) {
      rejectNextThreadDataUpdate = false;
      const transaction = transactionContext.getStore();
      if (transaction) transaction.aborted = true;
      throw new Error("database write failed");
    }
    threadData.set(id, data);
    return true;
  }),
}));

const runAgentLoopMock = vi.fn();
const instrumentAgentLoopMock = vi.fn();
const getObservabilityConfigMock = vi.fn();
const abortRunMock = vi.fn();
const getRunMock = vi.fn();
const subscribeToRunMock = vi.fn();
const persistedRunEventIds: string[] = [];
const persistedTerminalRunEventIds: string[] = [];
const startRunWork: Promise<void>[] = [];
vi.mock("../agent/run-manager.js", () => ({
  startRun: (
    runId: string,
    threadId: string,
    runFn: (send: any, signal: any) => Promise<void>,
    onComplete?: (run: any) => Promise<void>,
    options?: any,
  ) => {
    const work = (async () => {
      const events: any[] = [];
      const pendingEventWrites: Promise<unknown>[] = [];
      const send = (e: any) => {
        events.push({ seq: events.length, event: e });
        if (options?.persistEvent) {
          const terminal = [
            "done",
            "error",
            "missing_api_key",
            "loop_limit",
            "auto_continue",
          ].includes(e?.type);
          if (terminal) return;
          pendingEventWrites.push(
            options
              .persistEvent(async () => {}, { terminal: false })
              .then(() => {
                persistedRunEventIds.push(runId);
              }),
          );
        }
      };
      const signal = {
        aborted: false,
        addEventListener() {},
        removeEventListener() {},
      };
      try {
        await runFn(send, signal);
      } catch {
        /* ignore */
      }
      await Promise.allSettled(pendingEventWrites);
      const run = {
        runId,
        threadId,
        turnId: options?.turnId ?? runId,
        events,
        status: "completed",
        subscribers: new Set(),
        abort: new AbortController(),
        startedAt: Date.now(),
      };
      if (onComplete) await onComplete(run);
      if (options?.persistEvent) {
        await options.persistEvent(async () => {}, { terminal: true });
        persistedRunEventIds.push(runId);
        persistedTerminalRunEventIds.push(runId);
      }
    })();
    startRunWork.push(work);
    return {
      runId,
      threadId,
      turnId: runId,
      events: [],
      status: "running",
      subscribers: new Set(),
      abort: new AbortController(),
      startedAt: Date.now(),
      finalized: work,
    };
  },
  abortRun: abortRunMock,
  getActiveRunForThreadAsync: vi.fn(async () => null),
  getRun: getRunMock,
  subscribeToRun: subscribeToRunMock,
}));

const getRunEventsSinceMock = vi.fn(async () => []);
vi.mock("../agent/run-store.js", () => ({
  getRunEventsSince: getRunEventsSinceMock,
}));

const actionsToEngineToolsMock = vi.fn(() => [] as Array<{ name: string }>);

function fakeFilterInitialEngineTools(
  tools: Array<{ name: string }>,
  initialToolNames?: string[],
): Array<{ name: string }> {
  if (!initialToolNames) return tools;
  const defaultNames = new Set([
    "resources",
    "framework-search",
    "docs-search",
    "get-framework-context",
    "read-attachment",
  ]);
  const names = new Set(initialToolNames);
  names.add("tool-search");
  for (const tool of tools) {
    if (defaultNames.has(tool.name)) names.add(tool.name);
  }
  return tools.filter((tool) => names.has(tool.name));
}

vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: (actions: any) => actionsToEngineToolsMock(actions),
  filterActionsByAllowedNames: (
    actions: Record<string, unknown>,
    allowedActionNames: string[],
  ) => {
    const unknown = allowedActionNames.filter((name) => !actions[name]);
    if (unknown.length > 0) throw new Error(`Unknown actions: ${unknown}`);
    return Object.fromEntries(
      allowedActionNames.map((name) => [name, actions[name]]),
    );
  },
  filterInitialEngineTools: fakeFilterInitialEngineTools,
  readPersistedAllowedActionNames: (value: unknown) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !Object.prototype.hasOwnProperty.call(value, "allowedActionNames")
    ) {
      return undefined;
    }
    const names = (value as { allowedActionNames?: unknown })
      .allowedActionNames;
    return Array.isArray(names) &&
      names.every((name) => typeof name === "string")
      ? [...new Set(names)]
      : [];
  },
  resolveAgentRequestReasoningEffort: ({ model }: { model: string }) =>
    model === "gpt-5.6" ? "medium" : undefined,
  resolveMainChatMaxOutputTokens: (model: string) =>
    model === "gpt-5.6" ? 64_000 : 8_192,
  appendAgentLoopContinuation: vi.fn(),
  runAgentLoop: (opts: any) => runAgentLoopMock(opts),
}));

vi.mock("../observability/traces.js", () => ({
  getObservabilityConfig: () => getObservabilityConfigMock(),
  instrumentAgentLoop: (opts: any) => instrumentAgentLoopMock(opts),
}));

vi.mock("../agent/tool-search.js", () => ({
  TOOL_SEARCH_ACTION_NAME: "tool-search",
  attachToolSearch: (registry: Record<string, unknown>) => {
    registry["tool-search"] = {
      tool: { description: "Discover callable tools.", parameters: {} },
      run: async () => "{}",
    };
    return registry;
  },
}));

vi.mock("../progress/registry.js", () => ({
  startRun: vi.fn(async () => ({})),
  updateRunProgress: vi.fn(async () => ({})),
  completeRun: completeProgressRunMock,
  getRun: getProgressRunMock,
}));

vi.mock("../notifications/store.js", () => ({
  insertNotification: insertNotificationMock,
}));

vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: vi.fn(async () => null),
}));

vi.mock("./request-context.js", () => ({
  getRequestUserEmail: () => activeRequestContext?.userEmail,
  getRequestOrgId: () => activeRequestContext?.orgId,
  getRequestRunContext: () => activeRequestContext?.run,
  runWithRequestContext: (ctx: any, fn: () => any) => {
    const previous = activeRequestContext;
    activeRequestContext = ctx;
    requestContexts.push(ctx);
    try {
      const result = fn();
      if (result && typeof result.then === "function") {
        return result.finally(() => {
          activeRequestContext = previous;
        });
      }
      activeRequestContext = previous;
      return result;
    } catch (err) {
      activeRequestContext = previous;
      throw err;
    }
  },
}));

const dispatches: Array<{ taskId: string; body?: any; event?: any }> = [];
const fireInternalDispatchMock = vi.fn(async (o: any) => {
  dispatches.push({ taskId: o.taskId, body: o.body, event: o.event });
});
vi.mock("./self-dispatch.js", () => ({
  fireInternalDispatch: fireInternalDispatchMock,
}));

const queue = await import("./agent-teams-run-queue.js");
const {
  listAgentTeamBackgroundTranscriptEvents,
  getTask,
  listTasks,
  processAgentTeamRun,
  reconcileStaleAgentTeamRuns,
  reconcileAgentTeamRunsForOwner,
  stopAgentTeamBackgroundRun,
} = await import("./agent-teams.js");
const { runWithRequestContext } = await import("./request-context.js");

const OWNER = "owner@example.com";

async function seedTask(
  taskId: string,
  parentRunId?: string,
  allowedActionNames?: string[],
) {
  await queue.enqueueAgentTeamRun({
    taskId,
    threadId: "thread-1",
    runId: `run-task-${taskId}`,
    ownerEmail: OWNER,
    orgId: null,
    payload: {
      description: "do the thing",
      turnId: `run-task-${taskId}`,
      ...(parentRunId ? { parentRunId } : {}),
      ...(allowedActionNames ? { allowedActionNames } : {}),
    },
  });
  appState.set(`agent-task:${taskId}`, {
    taskId,
    threadId: "thread-1",
    ownerEmail: OWNER,
    orgId: null,
    description: "do the thing",
    status: "running",
    preview: "",
    summary: "",
    currentStep: "Starting sub-agent",
    createdAt: Date.now(),
    runId: `run-task-${taskId}`,
  });
}

function resolveConfig() {
  return {
    baseSystemPrompt: "base",
    actions: {},
    engine: { name: "test", defaultModel: "m" } as any,
    model: "gpt-5.6",
  };
}

describe("processAgentTeamRun (durable serverless execution)", () => {
  beforeEach(async () => {
    await Promise.allSettled(startRunWork);
    startRunWork.length = 0;
    queueRows = [];
    failNextDispatchStateRead = false;
    reclaimAfterNextDispatchStateRead = false;
    failParentCompletionReadFor = null;
    rejectNextThreadDataUpdate = false;
    transactionTail = Promise.resolve();
    appState.clear();
    threadData.clear();
    dispatches.length = 0;
    requestContexts.length = 0;
    activeRequestContext = undefined;
    queue._agentTeamRunQueueForTests.resetInit();
    runAgentLoopMock.mockReset();
    instrumentAgentLoopMock.mockReset();
    instrumentAgentLoopMock.mockImplementation(
      async ({ runAgentLoop, loopOpts }: any) => runAgentLoop(loopOpts),
    );
    getObservabilityConfigMock.mockReset();
    getObservabilityConfigMock.mockResolvedValue({ enabled: true });
    getRunMock.mockReset();
    abortRunMock.mockReset();
    persistedRunEventIds.length = 0;
    persistedTerminalRunEventIds.length = 0;
    subscribeToRunMock.mockReset();
    getRunEventsSinceMock.mockReset();
    getRunEventsSinceMock.mockResolvedValue([]);
    completeProgressRunMock.mockReset();
    completeProgressRunMock.mockResolvedValue({ status: "succeeded" });
    getProgressRunMock.mockReset();
    getProgressRunMock.mockResolvedValue({ status: "succeeded" });
    insertNotificationMock.mockReset();
    insertNotificationMock.mockResolvedValue({ id: "notification-1" });
    fireInternalDispatchMock.mockReset();
    fireInternalDispatchMock.mockImplementation(async (o: any) => {
      dispatches.push({ taskId: o.taskId, body: o.body, event: o.event });
    });
    vi.clearAllMocks();
  });

  it("claims, runs, and finalizes a queued sub-agent to completed", async () => {
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      opts.send({ type: "text", text: "the result" });
    });
    await seedTask("t1");

    const res = await processAgentTeamRun({
      taskId: "t1",
      mode: "start",
      resolveConfig: async () => resolveConfig(),
    });
    expect(res.ok).toBe(true);
    expect(runAgentLoopMock).toHaveBeenCalledTimes(1);
    expect(runAgentLoopMock.mock.calls[0]?.[0]).toMatchObject({
      maxOutputTokens: 64_000,
      reasoningEffort: "medium",
    });
    expect(requestContexts.some((ctx) => ctx.userEmail === OWNER)).toBe(true);

    const task = appState.get("agent-task:t1");
    expect(task.status).toBe("completed");
    expect(task.summary).toContain("the result");
    expect((await queue.getAgentTeamRunDispatchState("t1"))?.status).toBe(
      "done",
    );
    expect(threadData.get("thread-1")).toContain("the result");
  }, 20_000);

  it("does not replay completed actions when terminal transcript persistence fails", async () => {
    let completedActionCount = 0;
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      completedActionCount += 1;
      opts.send({ type: "text", text: "the action completed" });
    });
    rejectNextThreadDataUpdate = true;
    await seedTask("terminal-transcript-save-failure");

    await processAgentTeamRun({
      taskId: "terminal-transcript-save-failure",
      mode: "start",
      resolveConfig: async () => resolveConfig(),
    });

    expect(completedActionCount).toBe(1);
    expect(
      (
        await queue.getAgentTeamRunDispatchState(
          "terminal-transcript-save-failure",
        )
      )?.status,
    ).toBe("failed");
    expect(
      appState.get("agent-task:terminal-transcript-save-failure"),
    ).toMatchObject({
      status: "errored",
      summary: "the action completed",
      error: expect.stringContaining("Automatic retry was stopped"),
    });
    const failedTerminalRow = queueRows.find(
      (row) => row.task_id === "terminal-transcript-save-failure",
    );
    if (!failedTerminalRow) throw new Error("missing failed terminal row");
    failedTerminalRow.updated_at =
      Date.now() - queue.RUN_PROCESSING_STUCK_AFTER_MS - 1;
    await expect(reconcileStaleAgentTeamRuns()).resolves.toEqual({
      examined: 0,
      failed: 0,
    });
    expect(completedActionCount).toBe(1);
    expect(dispatches).toHaveLength(0);
  });

  it("does not requeue a continuation when chunk transcript persistence fails", async () => {
    let completedActionCount = 0;
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      completedActionCount += 1;
      opts.send({ type: "text", text: "the chunk action completed" });
      opts.send({ type: "auto_continue", reason: "run_timeout" });
    });
    rejectNextThreadDataUpdate = true;
    await seedTask("continuation-transcript-save-failure");

    await processAgentTeamRun({
      taskId: "continuation-transcript-save-failure",
      mode: "start",
      resolveConfig: async () => resolveConfig(),
    });

    expect(completedActionCount).toBe(1);
    expect(
      (
        await queue.getAgentTeamRunDispatchState(
          "continuation-transcript-save-failure",
        )
      )?.status,
    ).toBe("failed");
    expect(
      appState.get("agent-task:continuation-transcript-save-failure"),
    ).toMatchObject({
      status: "errored",
      summary: "the chunk action completed",
      error: expect.stringContaining("Automatic retry was stopped"),
    });
    expect(dispatches).toHaveLength(0);
    const failedContinuationRow = queueRows.find(
      (row) => row.task_id === "continuation-transcript-save-failure",
    );
    if (!failedContinuationRow) {
      throw new Error("missing failed continuation row");
    }
    failedContinuationRow.updated_at =
      Date.now() - queue.RUN_PROCESSING_STUCK_AFTER_MS - 1;
    await expect(reconcileStaleAgentTeamRuns()).resolves.toEqual({
      examined: 0,
      failed: 0,
    });
    expect(completedActionCount).toBe(1);
  });

  it("persists the terminal event after the queue row is finalized", async () => {
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      opts.send({ type: "text", text: "terminal event result" });
    });
    await seedTask("terminal-event");

    await processAgentTeamRun({
      taskId: "terminal-event",
      mode: "start",
      resolveConfig: async () => resolveConfig(),
    });

    await vi.waitFor(() =>
      expect(persistedTerminalRunEventIds).toContain(
        "run-task-terminal-event-a1-c0",
      ),
    );
    expect(appState.get("agent-task:terminal-event").status).toBe("completed");
    expect(
      (await queue.getAgentTeamRunDispatchState("terminal-event"))?.status,
    ).toBe("done");
  });

  it("records child-run telemetry with the durable parent correlation", async () => {
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      opts.send({ type: "text", text: "the traced result" });
    });
    await seedTask("telemetry", "run-parent-123");

    await processAgentTeamRun({
      taskId: "telemetry",
      mode: "start",
      resolveConfig: async () => resolveConfig(),
    });

    expect(instrumentAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-task-telemetry-a1-c0",
        threadId: "thread-1",
        userId: OWNER,
        delegation: {
          protocol: "agent-team",
          callerApp: "agent-teams",
          taskId: "telemetry",
          parentRunId: "run-parent-123",
        },
      }),
    );
  });

  it("fences a reclaimed worker's transcript and gives each retry a new run id", async () => {
    let announceFirstRun!: () => void;
    let releaseFirstRun!: () => void;
    const firstRunStarted = new Promise<void>((resolve) => {
      announceFirstRun = resolve;
    });
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    runAgentLoopMock
      .mockImplementationOnce(async (opts: any) => {
        announceFirstRun();
        await firstRunGate;
        opts.send({ type: "text", text: "stale attempt" });
      })
      .mockImplementationOnce(async (opts: any) => {
        opts.send({ type: "text", text: "current attempt" });
      });
    await seedTask("reclaimed");

    const staleAttempt = processAgentTeamRun({
      taskId: "reclaimed",
      mode: "start",
      resolveConfig: async () => resolveConfig(),
    });
    await firstRunStarted;

    const row = queueRows.find(
      (candidate) => candidate.task_id === "reclaimed",
    );
    if (!row) throw new Error("missing claimed task row");
    row.updated_at = Date.now() - queue.RUN_DISPATCH_STUCK_AFTER_MS - 1;
    await processAgentTeamRun({
      taskId: "reclaimed",
      mode: "start",
      resolveConfig: async () => resolveConfig(),
    });

    releaseFirstRun();
    await staleAttempt;

    const task = appState.get("agent-task:reclaimed");
    expect(task.status).toBe("completed");
    expect(task.summary).toContain("current attempt");
    expect(task.summary).not.toContain("stale attempt");
    expect(threadData.get("thread-1")).toContain("current attempt");
    expect(threadData.get("thread-1")).not.toContain("stale attempt");
    expect(
      instrumentAgentLoopMock.mock.calls.map(([options]) => options.runId),
    ).toEqual(["run-task-reclaimed-a1-c0", "run-task-reclaimed-a2-c0"]);
    expect(persistedRunEventIds).toContain("run-task-reclaimed-a2-c0");
    expect(persistedRunEventIds).not.toContain("run-task-reclaimed-a1-c0");
  });

  it("reapplies the persisted action surface in the durable processor", async () => {
    actionsToEngineToolsMock.mockImplementation((actions: any) =>
      Object.keys(actions).map((name) => ({ name })),
    );
    runAgentLoopMock.mockImplementation(async () => {});
    await seedTask("surface", undefined, ["allowed"]);

    await processAgentTeamRun({
      taskId: "surface",
      mode: "start",
      resolveConfig: async () => ({
        ...resolveConfig(),
        actions: {
          allowed: {
            tool: { description: "Allowed", parameters: {} },
            run: async () => "allowed",
          },
          denied: {
            tool: { description: "Denied", parameters: {} },
            run: async () => "denied",
          },
        },
      }),
    });

    expect(actionsToEngineToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({ allowed: expect.any(Object) }),
    );
    expect(actionsToEngineToolsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ denied: expect.any(Object) }),
    );
  });

  it("restores the persisted surface inside the durable agent loop context", async () => {
    let observedAllowedActionNames: readonly string[] | undefined;
    runAgentLoopMock.mockImplementation(async () => {
      observedAllowedActionNames =
        activeRequestContext?.run?.allowedActionNames;
    });
    await seedTask("surface-context", undefined, ["allowed"]);

    await processAgentTeamRun({
      taskId: "surface-context",
      mode: "start",
      resolveConfig: async () => ({
        ...resolveConfig(),
        actions: {
          allowed: {
            tool: { description: "Allowed", parameters: {} },
            run: async () => "allowed",
          },
        },
      }),
    });

    expect(runAgentLoopMock).toHaveBeenCalledTimes(1);
    expect(observedAllowedActionNames).toEqual(["allowed"]);
  });

  it("treats a malformed persisted sub-agent surface as an empty allowlist", async () => {
    actionsToEngineToolsMock.mockImplementation((actions: any) =>
      Object.keys(actions).map((name) => ({ name })),
    );
    runAgentLoopMock.mockImplementation(async () => {});
    await seedTask("malformed-surface");
    const queued = queueRows.find((row) => row.task_id === "malformed-surface");
    if (!queued) throw new Error("missing malformed-surface queue row");
    queued.payload = JSON.stringify({
      description: "do the thing",
      turnId: "run-task-malformed-surface",
      allowedActionNames: null,
    });
    let resolvedAllowedActionNames: unknown;

    await processAgentTeamRun({
      taskId: "malformed-surface",
      mode: "start",
      resolveConfig: async ({ payload }) => {
        resolvedAllowedActionNames = payload.allowedActionNames;
        return {
          ...resolveConfig(),
          actions: {
            denied: {
              tool: { description: "Denied", parameters: {} },
              run: async () => "denied",
            },
          },
        };
      },
    });

    expect(resolvedAllowedActionNames).toEqual([]);
    expect(actionsToEngineToolsMock).toHaveBeenCalledWith({});
  }, 20_000);

  it("fails closed if a persisted sub-agent action no longer exists", async () => {
    await seedTask("missing-surface", undefined, ["removed"]);

    const result = await processAgentTeamRun({
      taskId: "missing-surface",
      mode: "start",
      resolveConfig: async () => ({
        ...resolveConfig(),
        actions: {},
      }),
    });

    expect(result).toEqual({ ok: false, skipped: "config-failed" });
    expect(appState.get("agent-task:missing-surface").status).toBe("errored");
    expect(runAgentLoopMock).not.toHaveBeenCalled();
  });

  it("defers framework-added tools behind tool-search on the first sub-agent request when an initial tool list is supplied", async () => {
    actionsToEngineToolsMock.mockImplementation(
      (actionsMap: Record<string, { tool: { description: string } }>) =>
        Object.keys(actionsMap).map((name) => ({
          name,
          description: actionsMap[name].tool.description,
          inputSchema: { type: "object", properties: {} },
        })),
    );
    const noopTool = (description: string) => ({
      tool: { description, parameters: { type: "object", properties: {} } },
      run: async () => "ok",
    });
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      opts.send({ type: "text", text: "the result" });
    });
    await seedTask("t-tool-filter");

    const res = await processAgentTeamRun({
      taskId: "t-tool-filter",
      mode: "start",
      resolveConfig: async () => ({
        baseSystemPrompt: "base",
        actions: {
          "template-team-action": noopTool("A team-relevant app action"),
          "list-integration-memory": noopTool("Framework addition"),
        },
        initialToolNames: ["template-team-action"],
        engine: { name: "test", defaultModel: "m" } as any,
        model: "m",
      }),
    });

    expect(res.ok).toBe(true);
    expect(runAgentLoopMock).toHaveBeenCalledTimes(1);
    const call = runAgentLoopMock.mock.calls[0]?.[0];
    const firstRequestToolNames = call.tools
      .map((tool: { name: string }) => tool.name)
      .sort();
    const availableToolNames = call.availableTools
      .map((tool: { name: string }) => tool.name)
      .sort();

    expect(firstRequestToolNames).toEqual([
      "template-team-action",
      "tool-search",
    ]);
    expect(firstRequestToolNames).not.toContain("list-integration-memory");
    expect(availableToolNames).toEqual([
      "list-integration-memory",
      "template-team-action",
      "tool-search",
    ]);
  }, 20_000);

  it("is idempotent: a duplicate dispatch does not re-run the agent", async () => {
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      opts.send({ type: "text", text: "once" });
    });
    await seedTask("t2");

    await processAgentTeamRun({
      taskId: "t2",
      resolveConfig: async () => resolveConfig(),
    });
    const second = await processAgentTeamRun({
      taskId: "t2",
      resolveConfig: async () => resolveConfig(),
    });

    expect(second.skipped).toBeTruthy();
    expect(runAgentLoopMock).toHaveBeenCalledTimes(1);
  });

  it("self-fires a continuation at a soft-timeout boundary, then finalizes", async () => {
    runAgentLoopMock
      .mockImplementationOnce(async (opts: any) => {
        opts.send({ type: "text", text: "partial " });
        opts.send({ type: "auto_continue", reason: "run_timeout" });
      })
      .mockImplementationOnce(async (opts: any) => {
        opts.send({ type: "text", text: "and the rest" });
      });
    await seedTask("t3");

    await processAgentTeamRun({
      taskId: "t3",
      mode: "start",
      resolveConfig: async () => resolveConfig(),
    });
    expect(appState.get("agent-task:t3").status).toBe("running");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      taskId: "t3",
      body: { mode: "continue" },
    });
    expect(
      (await queue.getAgentTeamRunDispatchState("t3"))?.continuationCount,
    ).toBe(1);

    await processAgentTeamRun({
      taskId: "t3",
      mode: "continue",
      resolveConfig: async () => resolveConfig(),
    });
    expect(runAgentLoopMock).toHaveBeenCalledTimes(2);
    const task = appState.get("agent-task:t3");
    expect(task.status).toBe("completed");
    expect((await queue.getAgentTeamRunDispatchState("t3"))?.status).toBe(
      "done",
    );
  });

  it("persists a chunk terminal event before a fast continuation claim", async () => {
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      opts.send({ type: "text", text: "partial result" });
      opts.send({ type: "auto_continue", reason: "run_timeout" });
    });
    await seedTask("continuation-terminal-order");
    fireInternalDispatchMock.mockImplementation(async (options: any) => {
      dispatches.push({
        taskId: options.taskId,
        body: options.body,
        event: options.event,
      });
      await queue.claimAgentTeamRun(options.taskId);
    });

    await processAgentTeamRun({
      taskId: "continuation-terminal-order",
      resolveConfig: async () => resolveConfig(),
    });

    expect(persistedTerminalRunEventIds).toContain(
      "run-task-continuation-terminal-order-a1-c0",
    );
    expect(
      await queue.getAgentTeamRunDispatchState("continuation-terminal-order"),
    ).toMatchObject({ status: "running", attempts: 2 });
  });

  it("re-fires stale queued work with the caller event", async () => {
    const now = Date.UTC(2026, 5, 2, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    await seedTask("t4");
    const row = queueRows.find((x) => x.task_id === "t4");
    if (!row) throw new Error("missing queued task row");
    row.status = "running";
    row.updated_at = now - queue.RUN_DISPATCH_STUCK_AFTER_MS - 1;
    const event = {
      node: {
        req: {
          headers: {
            host: "app.example.test",
            "x-forwarded-proto": "https",
          },
        },
      },
    };

    await runWithRequestContext({ userEmail: OWNER }, () =>
      reconcileAgentTeamRunsForOwner(OWNER, event),
    );

    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      taskId: "t4",
      body: { mode: "start" },
    });
    expect(dispatches[0].event).toBe(event);
    nowSpy.mockRestore();
  });

  it("keeps stale queued work retryable when self-dispatch rejects", async () => {
    const now = Date.UTC(2026, 5, 2, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    await seedTask("t5-dispatch-fail");
    const row = queueRows.find((x) => x.task_id === "t5-dispatch-fail");
    if (!row) throw new Error("missing queued task row");
    row.status = "running";
    row.updated_at = now - queue.RUN_DISPATCH_STUCK_AFTER_MS - 1;
    fireInternalDispatchMock.mockRejectedValueOnce(
      new Error(
        "Self-dispatch to /_agent-native/agent-teams/_process-run returned HTTP 503 Service Unavailable",
      ),
    );

    await runWithRequestContext({ userEmail: OWNER }, () =>
      reconcileAgentTeamRunsForOwner(OWNER),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      reconcileAgentTeamRunsForOwner(OWNER),
    );

    const task = appState.get("agent-task:t5-dispatch-fail");
    expect(task.status).toBe("running");
    expect(fireInternalDispatchMock).toHaveBeenCalledTimes(1);
    expect(
      (await queue.getAgentTeamRunDispatchState("t5-dispatch-fail"))?.status,
    ).toBe("running");
    nowSpy.mockRestore();
  });

  it("does not fail a task when its queue state cannot be read", async () => {
    const now = Date.UTC(2026, 5, 2, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    await seedTask("t5-queue-read-fail");
    const row = queueRows.find((x) => x.task_id === "t5-queue-read-fail");
    if (!row) throw new Error("missing queued task row");
    row.status = "running";
    row.updated_at = now - 30_000;
    appState.get("agent-task:t5-queue-read-fail").startedAt = now - 120_000;
    failNextDispatchStateRead = true;

    await runWithRequestContext({ userEmail: OWNER }, () =>
      reconcileAgentTeamRunsForOwner(OWNER),
    );

    expect(appState.get("agent-task:t5-queue-read-fail").status).toBe(
      "running",
    );
    expect(
      (await queue.getAgentTeamRunDispatchState("t5-queue-read-fail"))?.status,
    ).toBe("running");
    nowSpy.mockRestore();
  });

  it("keeps direct task readers available when queue state cannot be read", async () => {
    await seedTask("t5-reader-get");
    failNextDispatchStateRead = true;
    const getWarning = vi.spyOn(console, "warn").mockImplementation(() => {});

    const task = await runWithRequestContext({ userEmail: OWNER }, () =>
      getTask("t5-reader-get", { ownerEmail: OWNER }),
    );
    expect(task?.status).toBe("running");

    await seedTask("t5-reader-list");
    failNextDispatchStateRead = true;
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        listTasks({ ownerEmail: OWNER }),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "t5-reader-list",
          status: "running",
        }),
        expect.objectContaining({ taskId: "t5-reader-get", status: "running" }),
      ]),
    );
    getWarning.mockRestore();
  });

  it("does not fail a task from a stale queue snapshot after a worker reclaims it", async () => {
    const now = Date.UTC(2026, 5, 2, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    await seedTask("t5-reconcile-reclaim-race");
    const row = queueRows.find(
      (candidate) => candidate.task_id === "t5-reconcile-reclaim-race",
    );
    if (!row) throw new Error("missing queued task row");
    row.status = "running";
    row.updated_at = now - queue.RUN_PROCESSING_STUCK_AFTER_MS - 1;
    reclaimAfterNextDispatchStateRead = true;

    const task = await runWithRequestContext({ userEmail: OWNER }, () =>
      getTask("t5-reconcile-reclaim-race", { ownerEmail: OWNER }),
    );
    const dispatch = await queue.getAgentTeamRunDispatchState(
      "t5-reconcile-reclaim-race",
    );

    expect(task?.status).toBe("running");
    expect(dispatch).toMatchObject({ status: "running", attempts: 1 });
    nowSpy.mockRestore();
  });

  it("reconciles stale queued work across owners from the durable sweep", async () => {
    const now = Date.UTC(2026, 5, 2, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    await seedTask("t5-durable-sweep");
    const row = queueRows.find((x) => x.task_id === "t5-durable-sweep");
    if (!row) throw new Error("missing queued task row");
    row.updated_at = now - queue.RUN_DISPATCH_STUCK_AFTER_MS - 1;

    await expect(reconcileStaleAgentTeamRuns()).resolves.toEqual({
      examined: 1,
      failed: 0,
    });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      taskId: "t5-durable-sweep",
      body: { mode: "start" },
    });
    expect(appState.get("agent-task:t5-durable-sweep").status).toBe("running");
    nowSpy.mockRestore();
  });

  it("caps a stale sweep and gives unattempted runs priority over repeat failures", async () => {
    const now = Date.UTC(2026, 5, 2, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    for (let index = 0; index < 6; index += 1) {
      const taskId = `t5-fairness-${index}`;
      await seedTask(taskId);
      const row = queueRows.find((candidate) => candidate.task_id === taskId);
      if (!row) throw new Error(`missing queued task row ${taskId}`);
      row.updated_at = now - 60_000 - index;
    }
    fireInternalDispatchMock.mockRejectedValue(
      new Error("temporary processor failure"),
    );

    await expect(reconcileStaleAgentTeamRuns()).resolves.toEqual({
      examined: 0,
      failed: 5,
    });
    expect(fireInternalDispatchMock).toHaveBeenCalledTimes(5);

    fireInternalDispatchMock.mockImplementation(async (options: any) => {
      dispatches.push({
        taskId: options.taskId,
        body: options.body,
        event: options.event,
      });
    });
    await expect(reconcileStaleAgentTeamRuns()).resolves.toEqual({
      examined: 1,
      failed: 0,
    });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.taskId).toBe("t5-fairness-0");
    nowSpy.mockRestore();
  });

  it("lists transcript events from chunked run ids for the base background run", async () => {
    await seedTask("t5");
    const row = queueRows.find((x) => x.task_id === "t5");
    if (!row) throw new Error("missing queued task row");
    row.status = "done";
    row.continuation_count = 1;
    getRunEventsSinceMock.mockImplementation(async (runId: string) => {
      if (runId === "run-task-t5-c0") {
        return [
          {
            seq: 0,
            eventData: JSON.stringify({ type: "text", text: "first chunk" }),
          },
          {
            seq: 1,
            eventData: JSON.stringify({
              type: "text",
              text: "first chunk second event",
            }),
          },
        ];
      }
      if (runId === "run-task-t5-c1") {
        return [
          {
            seq: 0,
            eventData: JSON.stringify({ type: "text", text: "second chunk" }),
          },
          {
            seq: 1,
            eventData: JSON.stringify({
              type: "text",
              text: "second chunk second event",
            }),
          },
        ];
      }
      return [];
    });

    const events = await runWithRequestContext({ userEmail: OWNER }, () =>
      listAgentTeamBackgroundTranscriptEvents("run-task-t5"),
    );

    expect(events.map((event) => event.id)).toEqual([
      "run-task-t5-c0:0",
      "run-task-t5-c0:1",
      "run-task-t5-c1:0",
      "run-task-t5-c1:1",
    ]);
    expect(events.map((event) => event.runId)).toEqual([
      "run-task-t5",
      "run-task-t5",
      "run-task-t5",
      "run-task-t5",
    ]);
    expect(events.map((event) => event.message)).toEqual([
      "first chunk",
      "first chunk second event",
      "second chunk",
      "second chunk second event",
    ]);
    expect(events.map((event) => event.metadata?.sourceRunId)).toEqual([
      "run-task-t5-c0",
      "run-task-t5-c0",
      "run-task-t5-c1",
      "run-task-t5-c1",
    ]);
    expect(events.map((event) => event.metadata?.seq)).toEqual([0, 1, 2, 3]);
    expect(events.map((event) => event.metadata?.sourceSeq)).toEqual([
      0, 1, 0, 1,
    ]);
  });

  it("includes the claimed attempt when reading a live task transcript", async () => {
    await seedTask("active-transcript");
    const task = appState.get("agent-task:active-transcript");
    task.transcriptRunIds = ["run-task-active-transcript-a2-c1"];
    appState.set("agent-task:active-transcript", task);
    const row = queueRows.find(
      (candidate) => candidate.task_id === "active-transcript",
    );
    if (!row) throw new Error("missing queued task row");
    row.status = "running";
    row.attempts = 3;
    row.continuation_count = 2;
    row.updated_at = Date.now();
    getRunEventsSinceMock.mockImplementation(async (runId: string) =>
      runId === "run-task-active-transcript-a3-c2"
        ? [
            {
              seq: 0,
              eventData: JSON.stringify({
                type: "text",
                text: "current attempt output",
              }),
            },
          ]
        : [],
    );

    const events = await runWithRequestContext({ userEmail: OWNER }, () =>
      listAgentTeamBackgroundTranscriptEvents("run-task-active-transcript"),
    );

    expect(events.map((event) => event.message)).toEqual([
      "current attempt output",
    ]);
    expect(events[0]?.metadata?.sourceRunId).toBe(
      "run-task-active-transcript-a3-c2",
    );
  });

  it("repairs a terminal queue row whose task projection missed completion", async () => {
    await seedTask("reconcile-completion");
    const task = appState.get("agent-task:reconcile-completion");
    task.parentThreadId = "parent-thread";
    appState.set("agent-task:reconcile-completion", task);
    const row = queueRows.find(
      (candidate) => candidate.task_id === "reconcile-completion",
    );
    if (!row) throw new Error("missing queued task row");
    row.status = "done";

    const reconciled = await runWithRequestContext({ userEmail: OWNER }, () =>
      getTask("reconcile-completion"),
    );

    expect(reconciled?.status).toBe("completed");
    expect(reconciled?.terminalEffectsVersion).toBe(1);
    expect(reconciled?.terminalEffectsReconciled).toBe(true);
    expect(reconciled?.parentCompletionEnqueued).toBe(true);
    expect(
      appState.get("parent-completion:parent-thread:inj-reconcile-completion"),
    ).toMatchObject({
      taskId: "reconcile-completion",
      status: "completed",
    });
  });

  it("skips terminal-effect writes after reconciliation succeeds", async () => {
    await seedTask("terminal-effects-once");
    const task = appState.get("agent-task:terminal-effects-once");
    Object.assign(task, {
      status: "completed",
      summary: "finished",
      terminalEffectsVersion: 1,
      terminalEffectsReconciled: false,
      parentCompletionEnqueued: true,
    });
    appState.set("agent-task:terminal-effects-once", task);
    const row = queueRows.find(
      (candidate) => candidate.task_id === "terminal-effects-once",
    );
    if (!row) throw new Error("missing queued task row");
    row.status = "done";

    const firstRead = await runWithRequestContext({ userEmail: OWNER }, () =>
      getTask("terminal-effects-once"),
    );
    const transactionCount = queueDb.transaction.mock.calls.length;
    const progressReadCount = getProgressRunMock.mock.calls.length;
    const notificationCount = insertNotificationMock.mock.calls.length;

    expect(firstRead?.terminalEffectsReconciled).toBe(true);
    expect(
      appState.get("agent-task:terminal-effects-once")
        .terminalEffectsReconciled,
    ).toBe(true);

    await runWithRequestContext({ userEmail: OWNER }, () =>
      getTask("terminal-effects-once"),
    );

    expect(queueDb.transaction).toHaveBeenCalledTimes(transactionCount);
    expect(getProgressRunMock).toHaveBeenCalledTimes(progressReadCount);
    expect(insertNotificationMock).toHaveBeenCalledTimes(notificationCount);
  });

  it("retries terminal effects after notification persistence fails", async () => {
    await seedTask("terminal-effects-retry");
    const task = appState.get("agent-task:terminal-effects-retry");
    Object.assign(task, {
      status: "completed",
      summary: "finished",
      terminalEffectsVersion: 1,
      terminalEffectsReconciled: false,
      parentCompletionEnqueued: true,
    });
    appState.set("agent-task:terminal-effects-retry", task);
    const row = queueRows.find(
      (candidate) => candidate.task_id === "terminal-effects-retry",
    );
    if (!row) throw new Error("missing queued task row");
    row.status = "done";
    insertNotificationMock.mockRejectedValueOnce(
      new Error("notification store unavailable"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const firstRead = await runWithRequestContext({ userEmail: OWNER }, () =>
      getTask("terminal-effects-retry"),
    );
    expect(firstRead?.terminalEffectsReconciled).toBe(false);

    const secondRead = await runWithRequestContext({ userEmail: OWNER }, () =>
      getTask("terminal-effects-retry"),
    );
    expect(secondRead?.terminalEffectsReconciled).toBe(true);
    expect(insertNotificationMock).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });

  it("returns the stored task when direct-read reconciliation fails", async () => {
    await seedTask("reconcile-read-failure");
    const storedTask = appState.get("agent-task:reconcile-read-failure");
    storedTask.parentThreadId = "parent-read-failure";
    appState.set("agent-task:reconcile-read-failure", storedTask);
    const row = queueRows.find(
      (candidate) => candidate.task_id === "reconcile-read-failure",
    );
    if (!row) throw new Error("missing queued task row");
    row.status = "done";
    failParentCompletionReadFor = "parent-completion:parent-read-failure:";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const task = await runWithRequestContext({ userEmail: OWNER }, () =>
      getTask("reconcile-read-failure", { ownerEmail: OWNER }),
    );

    expect(task).toMatchObject({
      taskId: "reconcile-read-failure",
      status: "running",
      parentThreadId: "parent-read-failure",
    });
    expect(appState.get("agent-task:reconcile-read-failure").status).toBe(
      "running",
    );
    warn.mockRestore();
  });

  it("keeps one failed reconciliation from rejecting the task list", async () => {
    await seedTask("list-reconcile-failure");
    await seedTask("list-reconcile-success");
    const failedTask = appState.get("agent-task:list-reconcile-failure");
    failedTask.parentThreadId = "parent-list-failure";
    appState.set("agent-task:list-reconcile-failure", failedTask);
    for (const taskId of ["list-reconcile-failure", "list-reconcile-success"]) {
      const row = queueRows.find((candidate) => candidate.task_id === taskId);
      if (!row) throw new Error(`missing queued task row ${taskId}`);
      row.status = "done";
    }
    failParentCompletionReadFor = "parent-completion:parent-list-failure:";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const tasks = await runWithRequestContext({ userEmail: OWNER }, () =>
      listTasks({ ownerEmail: OWNER }),
    );

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "list-reconcile-failure",
          status: "running",
        }),
        expect.objectContaining({
          taskId: "list-reconcile-success",
          status: "completed",
        }),
      ]),
    );
    warn.mockRestore();
  });

  it("stops the currently active chunk run for a background task", async () => {
    await seedTask("t6");
    getRunMock.mockImplementation((runId: string) =>
      runId === "run-task-t6-a0-c0"
        ? { runId, events: [], status: "running" }
        : null,
    );

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        stopAgentTeamBackgroundRun("run-task-t6"),
      ),
    ).resolves.toEqual({
      ok: true,
    });

    expect(abortRunMock).toHaveBeenCalledWith("run-task-t6-a0-c0", "user");
    expect((await queue.getAgentTeamRunDispatchState("t6"))?.status).toBe(
      "failed",
    );
  });

  it("stops the durable active chunk when it is running on another instance", async () => {
    await seedTask("t7");
    const row = queueRows.find((x) => x.task_id === "t7");
    expect(row).toBeTruthy();
    row.status = "running";
    row.continuation_count = 3;
    getRunMock.mockReturnValue(null);

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        stopAgentTeamBackgroundRun("run-task-t7"),
      ),
    ).resolves.toEqual({
      ok: true,
    });

    expect(abortRunMock).toHaveBeenCalledWith("run-task-t7-a0-c3", "user");
    expect((await queue.getAgentTeamRunDispatchState("t7"))?.status).toBe(
      "failed",
    );
  });

  it("prefers the durable active chunk over a retained terminal old chunk", async () => {
    await seedTask("t8");
    const row = queueRows.find((x) => x.task_id === "t8");
    expect(row).toBeTruthy();
    row.status = "running";
    row.continuation_count = 1;
    getRunMock.mockImplementation((runId: string) =>
      runId === "run-task-t8-a0-c0"
        ? { runId, events: [], status: "completed" }
        : null,
    );

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        stopAgentTeamBackgroundRun("run-task-t8"),
      ),
    ).resolves.toEqual({
      ok: true,
    });

    expect(abortRunMock).toHaveBeenCalledWith("run-task-t8-a0-c1", "user");
    expect((await queue.getAgentTeamRunDispatchState("t8"))?.status).toBe(
      "failed",
    );
  });

  it("does not strip chunk-looking suffixes from stable background run ids", async () => {
    await seedTask("task-ending-c1");
    getRunMock.mockImplementation((runId: string) =>
      runId === "run-task-task-ending-c1-a0-c0"
        ? { runId, events: [], status: "running" }
        : null,
    );

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        stopAgentTeamBackgroundRun("run-task-task-ending-c1"),
      ),
    ).resolves.toEqual({
      ok: true,
    });

    expect(abortRunMock).toHaveBeenCalledWith(
      "run-task-task-ending-c1-a0-c0",
      "user",
    );
  });

  it("finalizes with [hit-continuation-limit] marker after consecutive no-progress chunks", async () => {
    let chunkCount = 0;
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      chunkCount += 1;
      opts.send({ type: "auto_continue", reason: "run_timeout" });
    });
    await seedTask("tp-no-progress");

    await processAgentTeamRun({
      taskId: "tp-no-progress",
      mode: "start",
      noProgressCount: 0,
      resolveConfig: async () => resolveConfig(),
    });
    expect(appState.get("agent-task:tp-no-progress").status).toBe("running");
    expect(dispatches[0]).toMatchObject({
      body: { mode: "continue", noProgressCount: 1 },
    });

    await processAgentTeamRun({
      taskId: "tp-no-progress",
      mode: "continue",
      noProgressCount: 1,
      resolveConfig: async () => resolveConfig(),
    });
    expect(appState.get("agent-task:tp-no-progress").status).toBe("running");
    expect(dispatches[1]).toMatchObject({
      body: { mode: "continue", noProgressCount: 2 },
    });

    await processAgentTeamRun({
      taskId: "tp-no-progress",
      mode: "continue",
      noProgressCount: 2,
      resolveConfig: async () => resolveConfig(),
    });

    const task = appState.get("agent-task:tp-no-progress");
    expect(task.status).toBe("completed");
    expect(task.summary).toContain("[hit-continuation-limit]");
    expect(
      (await queue.getAgentTeamRunDispatchState("tp-no-progress"))?.status,
    ).toBe("done");
    expect(dispatches).toHaveLength(2);
  });

  it("resets no-progress counter when a chunk makes progress", async () => {
    let callCount = 0;
    runAgentLoopMock.mockImplementation(async (opts: any) => {
      callCount += 1;
      if (callCount === 2) {
        opts.send({ type: "text", text: "some progress" });
      }
      opts.send({ type: "auto_continue", reason: "run_timeout" });
    });
    await seedTask("tp-reset");

    await processAgentTeamRun({
      taskId: "tp-reset",
      mode: "start",
      noProgressCount: 0,
      resolveConfig: async () => resolveConfig(),
    });
    expect(dispatches[0].body.noProgressCount).toBe(1);

    await processAgentTeamRun({
      taskId: "tp-reset",
      mode: "continue",
      noProgressCount: 1,
      resolveConfig: async () => resolveConfig(),
    });
    expect(dispatches[1].body.noProgressCount).toBe(0);

    expect(appState.get("agent-task:tp-reset").status).toBe("running");
  });

  it("fenced heartbeat write no-ops when the row has been re-claimed (double-claim prevention)", async () => {
    await queue.enqueueAgentTeamRun({
      taskId: "tf-fence",
      threadId: "thread-fence",
      runId: "run-task-tf-fence",
      ownerEmail: OWNER,
      orgId: null,
      payload: { description: "fence test", turnId: "run-task-tf-fence" },
    });

    const firstClaim = await queue.claimAgentTeamRun("tf-fence");
    expect(firstClaim?.attempts).toBe(1);

    const row = queueRows.find((x) => x.task_id === "tf-fence");
    if (!row) throw new Error("missing row");
    row.status = "queued";
    const secondClaim = await queue.claimAgentTeamRun("tf-fence");
    expect(secondClaim?.attempts).toBe(2);

    const supersededTouched = await queue.touchAgentTeamRun("tf-fence", 1);
    expect(supersededTouched).toBe(false);

    const liveTouched = await queue.touchAgentTeamRun("tf-fence", 2);
    expect(liveTouched).toBe(true);

    const supersededCompleted = await queue.completeAgentTeamRun(
      "tf-fence",
      "done",
      1,
    );
    expect(supersededCompleted).toBe(false);
    expect((await queue.getAgentTeamRunDispatchState("tf-fence"))?.status).toBe(
      "running",
    );

    const liveCompleted = await queue.completeAgentTeamRun(
      "tf-fence",
      "done",
      2,
    );
    expect(liveCompleted).toBe(true);
    expect((await queue.getAgentTeamRunDispatchState("tf-fence"))?.status).toBe(
      "done",
    );
  });

  it("does not treat its own queue transition as lease loss, but detects a later claim", async () => {
    let heartbeatTick: (() => void) | undefined;
    const timer = vi.spyOn(globalThis, "setInterval").mockImplementation(((
      callback: () => void,
    ) => {
      heartbeatTick = callback;
      return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    let markLoopStarted!: () => void;
    const loopStarted = new Promise<void>((resolve) => {
      markLoopStarted = resolve;
    });
    let finishLoop!: () => void;
    const loopFinished = new Promise<void>((resolve) => {
      finishLoop = resolve;
    });
    runAgentLoopMock.mockImplementation(async () => {
      markLoopStarted();
      await loopFinished;
    });
    await seedTask("heartbeat-transition");

    const processing = processAgentTeamRun({
      taskId: "heartbeat-transition",
      mode: "start",
      resolveConfig: async () => resolveConfig(),
    });
    const dispatchStateReadCount = () =>
      queueDb.execute.mock.calls.filter(
        ([query]) =>
          typeof query !== "string" &&
          query.sql.includes(
            "SELECT * FROM agent_team_run_queue WHERE task_id = ?",
          ),
      ).length;

    try {
      await loopStarted;
      const row = queueRows.find(
        (candidate) => candidate.task_id === "heartbeat-transition",
      );
      if (!row) throw new Error("missing row");

      row.status = "queued";
      const queuedReadCount = dispatchStateReadCount();
      heartbeatTick?.();
      await vi.waitFor(() =>
        expect(dispatchStateReadCount()).toBeGreaterThan(queuedReadCount),
      );
      expect(abortRunMock).not.toHaveBeenCalled();

      expect(
        (await queue.claimAgentTeamRun("heartbeat-transition"))?.attempts,
      ).toBe(2);
      const reclaimedReadCount = dispatchStateReadCount();
      heartbeatTick?.();
      await vi.waitFor(() =>
        expect(dispatchStateReadCount()).toBeGreaterThan(reclaimedReadCount),
      );
      expect(abortRunMock).toHaveBeenCalledTimes(1);
    } finally {
      finishLoop();
      await processing;
      timer.mockRestore();
    }
  });
});

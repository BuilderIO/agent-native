import { beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory queue table (real queue module runs against this) ───────────
let queueRows: Record<string, any>[] = [];
function affected(n: number) {
  return { rows: [], rowsAffected: n };
}
const queueDb = {
  execute: vi.fn(async (q: string | { sql: string; args?: any[] }) => {
    const s = (typeof q === "string" ? q : q.sql).replace(/\s+/g, " ").trim();
    const args = typeof q === "string" ? [] : (q.args ?? []);
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
      });
      return affected(1);
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
      const [updatedAt, taskId] = args;
      const r = queueRows.find(
        (x) => x.task_id === taskId && x.status === "running",
      );
      if (r) {
        r.continuation_count += 1;
        r.status = "queued";
        r.updated_at = updatedAt;
        return affected(1);
      }
      return affected(0);
    }
    if (s.includes("SET status = ?, updated_at = ? WHERE task_id = ?")) {
      const [status, updatedAt, taskId] = args;
      const r = queueRows.find((x) => x.task_id === taskId);
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
      const [updatedAt, taskId] = args;
      const r = queueRows.find(
        (x) => x.task_id === taskId && x.status === "running",
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
    if (s.includes("SELECT * FROM agent_team_run_queue WHERE task_id = ?")) {
      const r = queueRows.find((x) => x.task_id === args[0]);
      return { rows: r ? [{ ...r }] : [], rowsAffected: 0 };
    }
    return affected(0);
  }),
};
vi.mock("../db/client.js", () => ({
  getDbExec: () => queueDb,
  intType: () => "INTEGER",
  retryOnDdlRace: (fn: () => unknown) => fn(),
}));

// ── app_state (task records + thread reverse-lookup) ──────────────────────
const appState = new Map<string, any>();
vi.mock("../application-state/script-helpers.js", () => ({
  readAppState: vi.fn(async (k: string) => appState.get(k) ?? null),
  writeAppState: vi.fn(async (k: string, v: any) => {
    appState.set(k, v);
  }),
  deleteAppState: vi.fn(async (k: string) => appState.delete(k)),
  listAppState: vi.fn(async (prefix: string) =>
    [...appState.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ key: k, value: v })),
  ),
}));

// ── chat thread store (thread_data round-trips through here) ──────────────
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
    threadData.set(id, data);
  }),
}));

// ── run-manager: drive runFn then onComplete with a synthetic run ─────────
const runAgentLoopMock = vi.fn();
vi.mock("../agent/run-manager.js", () => ({
  startRun: (
    runId: string,
    threadId: string,
    runFn: (send: any, signal: any) => Promise<void>,
    onComplete?: (run: any) => Promise<void>,
    options?: any,
  ) => {
    void (async () => {
      const events: any[] = [];
      const send = (e: any) => events.push({ seq: events.length, event: e });
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
    })();
    return {
      runId,
      threadId,
      turnId: runId,
      events: [],
      status: "running",
      subscribers: new Set(),
      abort: new AbortController(),
      startedAt: Date.now(),
    };
  },
  abortRun: vi.fn(),
  getActiveRunForThreadAsync: vi.fn(async () => null),
  getRun: vi.fn(),
  subscribeToRun: vi.fn(),
}));

vi.mock("../agent/run-store.js", () => ({ getRunEventsSince: vi.fn() }));

// ── production-agent: scripted agent loop ─────────────────────────────────
vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: () => [],
  appendAgentLoopContinuation: vi.fn(),
  runAgentLoop: (opts: any) => runAgentLoopMock(opts),
}));

// ── progress registry: no-op writes ──────────────────────────────────────
vi.mock("../progress/registry.js", () => ({
  startRun: vi.fn(async () => ({})),
  updateRunProgress: vi.fn(async () => ({})),
  completeRun: vi.fn(async () => ({})),
}));

vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: vi.fn(async () => null),
}));

vi.mock("./request-context.js", () => ({
  getRequestUserEmail: () => "owner@example.com",
  runWithRequestContext: (_ctx: any, fn: () => any) => fn(),
}));

// ── capture self-fire dispatches ──────────────────────────────────────────
const dispatches: Array<{ taskId: string; body?: any }> = [];
vi.mock("./self-dispatch.js", () => ({
  fireInternalDispatch: vi.fn(async (o: any) => {
    dispatches.push({ taskId: o.taskId, body: o.body });
  }),
}));

const queue = await import("./agent-teams-run-queue.js");
const { processAgentTeamRun } = await import("./agent-teams.js");

const OWNER = "owner@example.com";

async function seedTask(taskId: string) {
  await queue.enqueueAgentTeamRun({
    taskId,
    threadId: "thread-1",
    runId: `run-task-${taskId}`,
    ownerEmail: OWNER,
    orgId: null,
    payload: { description: "do the thing", turnId: `run-task-${taskId}` },
  });
  appState.set(`agent-task:${taskId}`, {
    taskId,
    threadId: "thread-1",
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
    model: "m",
  };
}

describe("processAgentTeamRun (durable serverless execution)", () => {
  beforeEach(() => {
    queueRows = [];
    appState.clear();
    threadData.clear();
    dispatches.length = 0;
    queue._agentTeamRunQueueForTests.resetInit();
    runAgentLoopMock.mockReset();
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

    const task = appState.get("agent-task:t1");
    expect(task.status).toBe("completed");
    expect(task.summary).toContain("the result");
    expect((await queue.getAgentTeamRunDispatchState("t1"))?.status).toBe(
      "done",
    );
    // thread_data persisted with the assistant turn
    expect(threadData.get("thread-1")).toContain("the result");
  });

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
    // First chunk hits the soft-timeout boundary; second chunk finishes.
    runAgentLoopMock
      .mockImplementationOnce(async (opts: any) => {
        opts.send({ type: "text", text: "partial " });
        opts.send({ type: "auto_continue", reason: "run_timeout" });
      })
      .mockImplementationOnce(async (opts: any) => {
        opts.send({ type: "text", text: "and the rest" });
      });
    await seedTask("t3");

    // Chunk 1 — should NOT finalize; should bump + self-fire a continuation.
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

    // Chunk 2 — the self-fired continuation completes the task.
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
});

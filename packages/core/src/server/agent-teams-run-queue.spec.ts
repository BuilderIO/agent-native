import { beforeEach, describe, expect, it, vi } from "vitest";

let rows: Record<string, any>[] = [];
let persistedEvents: Record<string, unknown>[] = [];

function affected(n: number) {
  return { rows: [], rowsAffected: n };
}

const mockDb = {
  execute: vi.fn(async (q: string | { sql: string; args?: any[] }) => {
    const rawSql = typeof q === "string" ? q : q.sql;
    const args = typeof q === "string" ? [] : (q.args ?? []);
    const s = rawSql.replace(/\s+/g, " ").trim();

    if (s.includes("CREATE TABLE") || s.includes("CREATE INDEX")) {
      return affected(0);
    }
    if (s.includes("WITH current_attempt AS MATERIALIZED")) {
      const [taskId, attempts, runId, seq, eventAt, eventData] = args;
      const row = rows.find((candidate) => candidate.task_id === taskId);
      const statuses = s.includes(
        "status IN ('queued', 'running', 'done', 'failed')",
      )
        ? ["queued", "running", "done", "failed"]
        : ["running"];
      const isCurrent =
        row && row.attempts === attempts && statuses.includes(row.status);
      if (
        isCurrent &&
        !persistedEvents.some(
          (event) => event.runId === runId && event.seq === seq,
        )
      ) {
        persistedEvents.push({ runId, seq, eventAt, eventData });
      }
      return {
        rows: [{ is_current: Boolean(isCurrent) }],
        rowsAffected: isCurrent ? 1 : 0,
      };
    }
    if (s.includes("INSERT INTO agent_team_run_queue")) {
      rows.push({
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
      const row = rows.find((candidate) => candidate.task_id === taskId);
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
      const r = rows.find((x) => x.task_id === taskId);
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
      const r = rows.find(
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
      const row = rows.find(
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
      const row = rows.find((candidate) => candidate.task_id === taskId);
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
      const r = rows.find(
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
      const r = rows.find(
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
      const r = rows.find((x) => x.task_id === args[0]);
      return {
        rows: r ? [{ continuation_count: r.continuation_count }] : [],
        rowsAffected: 0,
      };
    }
    if (s.includes("SELECT task_id FROM agent_team_run_queue")) {
      const owner = args[0];
      return {
        rows: rows
          .filter(
            (x) =>
              x.owner_email === owner &&
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
        rows: rows
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
      const r = rows.find((x) => x.task_id === args[0]);
      return { rows: r ? [{ ...r }] : [], rowsAffected: 0 };
    }
    if (
      s.includes(
        "SELECT status, attempts, updated_at FROM agent_team_run_queue",
      )
    ) {
      const r = rows.find((x) => x.task_id === args[0]);
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
    return affected(0);
  }),
  transaction: vi.fn(async <T>(fn: (tx: any) => Promise<T>) => fn(mockDb)),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  withDbExec: (_exec: unknown, fn: () => unknown) => fn(),
  retryOnDdlRace: (fn: () => unknown) => fn(),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../agent/run-store.js", () => ({
  ensureRunTables: vi.fn().mockResolvedValue(undefined),
}));

const queue = await import("./agent-teams-run-queue.js");

function enqueue(taskId: string, owner = "owner@example.com") {
  return queue.enqueueAgentTeamRun({
    taskId,
    threadId: `thread-${taskId}`,
    runId: `run-task-${taskId}`,
    ownerEmail: owner,
    orgId: null,
    payload: { description: "do work", turnId: `run-task-${taskId}` },
  });
}

describe("agent_team_run_queue", () => {
  beforeEach(() => {
    rows = [];
    persistedEvents = [];
    queue._agentTeamRunQueueForTests.resetInit();
    vi.clearAllMocks();
  });

  it("claims a queued run exactly once (idempotent on duplicate dispatch)", async () => {
    await enqueue("t1");
    const first = await queue.claimAgentTeamRun("t1");
    expect(first).not.toBeNull();
    expect(first?.status).toBe("running");
    expect(first?.attempts).toBe(1);

    const second = await queue.claimAgentTeamRun("t1");
    expect(second).toBeNull();
  });

  it("returns null when claiming a missing run", async () => {
    expect(await queue.claimAgentTeamRun("nope")).toBeNull();
  });

  it("re-queues + counts a continuation, then re-claims it", async () => {
    await enqueue("t2");
    await queue.claimAgentTeamRun("t2");
    const count = await queue.bumpAgentTeamContinuation("t2");
    expect(count).toBe(1);

    const reclaimed = await queue.claimAgentTeamRun("t2");
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.continuationCount).toBe(1);

    expect(await queue.claimAgentTeamRun("t2")).toBeNull();
  });

  it("lets the claimed worker finish after counting its final continuation", async () => {
    await enqueue("final-continuation");
    const claimed = await queue.claimAgentTeamRun("final-continuation");
    if (!claimed) throw new Error("run was not claimed");
    await queue.bumpAgentTeamContinuation(
      "final-continuation",
      claimed.attempts,
    );

    await expect(
      queue.completeAgentTeamRun(
        "final-continuation",
        "done",
        claimed.attempts,
      ),
    ).resolves.toBe(true);
    await expect(
      queue.getAgentTeamRunDispatchState("final-continuation"),
    ).resolves.toMatchObject({ status: "done", continuationCount: 1 });
  });

  it("does not re-claim a fresh running row, but re-claims a stale one", async () => {
    await enqueue("t3");
    await queue.claimAgentTeamRun("t3");

    expect(
      await queue.claimAgentTeamRun("t3", { stuckAfterMs: 15_000 }),
    ).toBeNull();

    const r = rows.find((x) => x.task_id === "t3")!;
    r.updated_at = Date.now() - 60_000;
    const reclaimed = await queue.claimAgentTeamRun("t3", {
      stuckAfterMs: 15_000,
    });
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.status).toBe("running");
  });

  it("fences persistence callbacks to the currently claimed attempt", async () => {
    await enqueue("fenced-write");
    const first = await queue.claimAgentTeamRun("fenced-write");
    if (!first) throw new Error("run was not claimed");

    let writes = 0;
    await expect(
      queue.withCurrentAgentTeamRunAttempt(
        "fenced-write",
        first.attempts,
        async () => ++writes,
      ),
    ).resolves.toEqual({ current: true, value: 1 });

    const row = rows.find((candidate) => candidate.task_id === "fenced-write");
    if (!row) throw new Error("missing queue row");
    row.updated_at = Date.now() - queue.RUN_DISPATCH_STUCK_AFTER_MS - 1;
    const reclaimed = await queue.claimAgentTeamRun("fenced-write");
    if (!reclaimed) throw new Error("stale run was not reclaimed");

    await expect(
      queue.withCurrentAgentTeamRunAttempt(
        "fenced-write",
        first.attempts,
        async () => ++writes,
      ),
    ).resolves.toEqual({ current: false });
    expect(writes).toBe(1);
  });

  it("persists run events with one current-attempt-fenced statement", async () => {
    await enqueue("event-write");
    const claimed = await queue.claimAgentTeamRun("event-write");
    if (!claimed) throw new Error("run was not claimed");
    mockDb.execute.mockClear();

    await expect(
      queue.persistAgentTeamRunEventIfCurrent({
        taskId: "event-write",
        claimedAttempts: claimed.attempts,
        runId: "run-event-write",
        seq: 0,
        eventData: '{"type":"text","text":"hello"}',
        terminal: false,
      }),
    ).resolves.toBe(true);

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    const [query] = mockDb.execute.mock.calls[0] ?? [];
    expect(typeof query === "object" && query.sql).toContain("FOR UPDATE");
    expect(persistedEvents).toMatchObject([
      {
        runId: "run-event-write",
        seq: 0,
        eventData: '{"type":"text","text":"hello"}',
      },
    ]);

    rows.find((row) => row.task_id === "event-write")!.attempts += 1;
    await expect(
      queue.persistAgentTeamRunEventIfCurrent({
        taskId: "event-write",
        claimedAttempts: claimed.attempts,
        runId: "run-event-write",
        seq: 1,
        eventData: '{"type":"text","text":"stale"}',
        terminal: false,
      }),
    ).resolves.toBe(false);
    expect(persistedEvents).toHaveLength(1);
  });

  it("requeues a continuation only for the current running attempt", async () => {
    await enqueue("continuation-fence");
    const claimed = await queue.claimAgentTeamRun("continuation-fence");
    if (!claimed) throw new Error("run was not claimed");

    await expect(
      queue.requeueAgentTeamRunContinuation(
        "continuation-fence",
        claimed.attempts,
      ),
    ).resolves.toBe(true);
    await expect(
      queue.getAgentTeamRunDispatchState("continuation-fence"),
    ).resolves.toMatchObject({ status: "queued" });
    await expect(
      queue.requeueAgentTeamRunContinuation(
        "continuation-fence",
        claimed.attempts,
      ),
    ).resolves.toBe(false);
  });

  it("rejects a stale reconciliation snapshot after a heartbeat", async () => {
    await enqueue("stale-snapshot");
    const claimed = await queue.claimAgentTeamRun("stale-snapshot");
    if (!claimed) throw new Error("run was not claimed");
    const row = rows.find(
      (candidate) => candidate.task_id === "stale-snapshot",
    );
    if (!row) throw new Error("missing claimed queue row");
    row.updated_at += 1;

    let writes = 0;
    await expect(
      queue.withCurrentAgentTeamRunAttempt(
        "stale-snapshot",
        claimed.attempts,
        async () => ++writes,
        {
          statuses: ["running"],
          expectedUpdatedAt: claimed.updatedAt,
        },
      ),
    ).resolves.toEqual({ current: false });
    expect(writes).toBe(0);
  });

  it("completes a run terminally", async () => {
    await enqueue("t4");
    await queue.claimAgentTeamRun("t4");
    await queue.completeAgentTeamRun("t4", "done");
    const state = await queue.getAgentTeamRunDispatchState("t4");
    expect(state?.status).toBe("done");
    expect(await queue.claimAgentTeamRun("t4")).toBeNull();
  });

  it("fences stale reconciliation and late worker terminal writes", async () => {
    await enqueue("fenced");
    const claimed = await queue.claimAgentTeamRun("fenced");
    if (!claimed) throw new Error("run was not claimed");
    const row = rows.find((candidate) => candidate.task_id === "fenced")!;
    const staleSnapshot = {
      status: claimed.status,
      attempts: claimed.attempts,
      updatedAt: claimed.updatedAt,
    };

    row.updated_at += 1;
    await expect(
      queue.completeAgentTeamRunIfCurrent("fenced", "failed", staleSnapshot),
    ).resolves.toBe(false);

    const current = await queue.getAgentTeamRunDispatchState("fenced");
    if (!current) throw new Error("run state disappeared");
    await expect(
      queue.completeAgentTeamRunIfCurrent("fenced", "failed", current),
    ).resolves.toBe(true);
    await expect(
      queue.completeAgentTeamRun("fenced", "done", claimed.attempts),
    ).resolves.toBe(false);
    await expect(
      queue.getAgentTeamRunDispatchState("fenced"),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("lists an owner's in-flight task ids only", async () => {
    await enqueue("a", "me@example.com");
    await enqueue("b", "me@example.com");
    await enqueue("c", "other@example.com");
    await queue.completeAgentTeamRun("b", "done");

    const ids =
      await queue.listActiveAgentTeamTaskIdsForOwner("me@example.com");
    expect(ids).toContain("a");
    expect(ids).not.toContain("b");
    expect(ids).not.toContain("c");
  });

  it("lists bounded stale runs with their owner and org scope", async () => {
    await enqueue("oldest", "first@example.com");
    await enqueue("newer", "second@example.com");
    await enqueue("fresh", "third@example.com");
    await queue.completeAgentTeamRun("newer", "done");
    const oldest = rows.find((row) => row.task_id === "oldest")!;
    oldest.updated_at = 10;
    oldest.org_id = "org-first";
    const newer = rows.find((row) => row.task_id === "newer")!;
    newer.updated_at = 20;
    const fresh = rows.find((row) => row.task_id === "fresh")!;
    fresh.updated_at = 30;

    await expect(queue.listStaleActiveAgentTeamRuns(25, 1)).resolves.toEqual([
      { taskId: "oldest", ownerEmail: "first@example.com", orgId: "org-first" },
    ]);
  });

  it("claims stale reconciliation attempts and rotates recently attempted rows", async () => {
    await enqueue("oldest");
    await enqueue("newer");
    const oldest = rows.find((row) => row.task_id === "oldest")!;
    oldest.updated_at = 10;
    const newer = rows.find((row) => row.task_id === "newer")!;
    newer.updated_at = 20;

    await expect(
      queue.claimAgentTeamRunReconciliationAttempt("oldest", 50, 100, 200),
    ).resolves.toBe(true);
    await expect(
      queue.claimAgentTeamRunReconciliationAttempt("oldest", 50, 100, 201),
    ).resolves.toBe(false);
    await expect(
      queue.listStaleActiveAgentTeamRuns(50, 5, 100),
    ).resolves.toEqual([
      { taskId: "newer", ownerEmail: "owner@example.com", orgId: null },
    ]);
    await expect(
      queue.listStaleActiveAgentTeamRuns(50, 5, 200),
    ).resolves.toEqual([
      { taskId: "newer", ownerEmail: "owner@example.com", orgId: null },
      { taskId: "oldest", ownerEmail: "owner@example.com", orgId: null },
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

let rows: Record<string, any>[] = [];

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
      const [updatedAt, taskId, claimedAttempts] = args;
      const r = rows.find(
        (x) =>
          x.task_id === taskId &&
          x.status === "running" &&
          (claimedAttempts === undefined || x.attempts === claimedAttempts),
      );
      if (r) {
        r.continuation_count += 1;
        r.status = "queued";
        r.updated_at = updatedAt;
        return affected(1);
      }
      return affected(0);
    }
    if (s.includes("SET status = ?, updated_at = ?")) {
      const [status, updatedAt, taskId, claimedAttempts] = args;
      const r = rows.find(
        (x) =>
          x.task_id === taskId &&
          (claimedAttempts === undefined || x.attempts === claimedAttempts),
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
    return affected(0);
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  retryOnDdlRace: (fn: () => unknown) => fn(),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
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

  it("completes a run terminally", async () => {
    await enqueue("t4");
    await queue.claimAgentTeamRun("t4");
    await queue.completeAgentTeamRun("t4", "done");
    const state = await queue.getAgentTeamRunDispatchState("t4");
    expect(state?.status).toBe("done");
    expect(await queue.claimAgentTeamRun("t4")).toBeNull();
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

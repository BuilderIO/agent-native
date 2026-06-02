import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal in-memory emulation of the agent_team_run_queue table, matching the
// exact statements the queue module issues. Whitespace-normalized so it's
// robust to formatting.
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
      });
      return affected(1);
    }
    // claim CAS
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
    // bump continuation
    if (s.includes("continuation_count = continuation_count + 1")) {
      const [updatedAt, taskId] = args;
      const r = rows.find(
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
    // complete
    if (s.includes("SET status = ?, updated_at = ? WHERE task_id = ?")) {
      const [status, updatedAt, taskId] = args;
      const r = rows.find((x) => x.task_id === taskId);
      if (r) {
        r.status = status;
        r.updated_at = updatedAt;
        return affected(1);
      }
      return affected(0);
    }
    // touch
    if (
      s.includes("SET updated_at = ? WHERE task_id = ? AND status = 'running'")
    ) {
      const [updatedAt, taskId] = args;
      const r = rows.find(
        (x) => x.task_id === taskId && x.status === "running",
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
    if (s.includes("SELECT * FROM agent_team_run_queue WHERE task_id = ?")) {
      const r = rows.find((x) => x.task_id === args[0]);
      return { rows: r ? [{ ...r }] : [], rowsAffected: 0 };
    }
    return affected(0);
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  intType: () => "INTEGER",
  retryOnDdlRace: (fn: () => unknown) => fn(),
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

    // A concurrent / duplicate self-fire must NOT re-run the sub-agent.
    const second = await queue.claimAgentTeamRun("t1");
    expect(second).toBeNull();
  });

  it("returns null when claiming a missing run", async () => {
    expect(await queue.claimAgentTeamRun("nope")).toBeNull();
  });

  it("re-queues + counts a continuation, then re-claims it", async () => {
    await enqueue("t2");
    await queue.claimAgentTeamRun("t2"); // running
    const count = await queue.bumpAgentTeamContinuation("t2");
    expect(count).toBe(1);

    // bumped back to queued → the next self-fire claims it cleanly.
    const reclaimed = await queue.claimAgentTeamRun("t2");
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.continuationCount).toBe(1);

    // and again, idempotent.
    expect(await queue.claimAgentTeamRun("t2")).toBeNull();
  });

  it("does not re-claim a fresh running row, but re-claims a stale one", async () => {
    await enqueue("t3");
    await queue.claimAgentTeamRun("t3"); // running, fresh

    // Fresh → a dropped-dispatch refire must not double-run it.
    expect(
      await queue.claimAgentTeamRun("t3", { stuckAfterMs: 15_000 }),
    ).toBeNull();

    // Age the row past the stuck cutoff → now re-claimable.
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
    // A late duplicate dispatch finds nothing to claim.
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
    expect(ids).not.toContain("b"); // terminal
    expect(ids).not.toContain("c"); // different owner
  });
});

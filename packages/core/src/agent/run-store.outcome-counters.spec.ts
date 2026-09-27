import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    if (/^\s*select/i.test(input.sql) || /\breturning\b/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [] as unknown[], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const { insertRun, cleanupOldRuns, getRunOutcomeCounters } =
  await import("./run-store.js");

const DAY_MS = 86_400_000;
const COMPLETED_RETENTION_MS = DAY_MS;
const ERRORED_RETENTION_MS = 7 * DAY_MS;

let seq = 0;
async function terminalRun(
  status: "completed" | "truncated" | "errored" | "aborted",
  terminalReason: string,
  completedAt: number,
): Promise<string> {
  seq += 1;
  const id = `run-outcome-${seq}`;
  await insertRun(id, `thread-outcome-${seq}`, `turn-${seq}`);
  await pglite
    .prepare(
      `UPDATE agent_runs SET status = ?, completed_at = ?, terminal_reason = ? WHERE id = ?`,
    )
    .run(status, completedAt, terminalReason, id);
  return id;
}

async function liveRunCount(): Promise<number> {
  return (
    (await (
      await pglite.prepare(`SELECT COUNT(*) AS n FROM agent_runs`)
    ).get()) as {
      n: number;
    }
  ).n;
}

beforeEach(async () => {
  for (const table of ["agent_runs", "agent_run_outcome_daily"]) {
    try {
      await pglite.exec(`DELETE FROM ${table}`);
    } catch {}
  }
});

describe("cleanupOldRuns — daily outcome counters survive asymmetric pruning", () => {
  it("counts completed runs into agent_run_outcome_daily before pruning deletes them", async () => {
    const prunedAt = Date.now() - (COMPLETED_RETENTION_MS + 60_000);
    const day = new Date(prunedAt).toISOString().slice(0, 10);
    await terminalRun("completed", "done", prunedAt);
    await terminalRun("completed", "done", prunedAt);
    await terminalRun("errored", "error:provider_network_error", prunedAt);

    await cleanupOldRuns(COMPLETED_RETENTION_MS, ERRORED_RETENTION_MS);

    expect(await liveRunCount()).toBe(1);
    expect(await getRunOutcomeCounters()).toEqual([
      { day, status: "completed", terminalReason: "done", count: 2 },
    ]);
  });

  it("makes the completion rate computable from counters plus live rows after the successes are gone", async () => {
    const prunedAt = Date.now() - (COMPLETED_RETENTION_MS + 60_000);
    await terminalRun("completed", "done", prunedAt);
    await terminalRun("completed", "done", prunedAt);
    await terminalRun("completed", "done", prunedAt);
    await terminalRun("errored", "error:stale_run", prunedAt);

    await cleanupOldRuns(COMPLETED_RETENTION_MS, ERRORED_RETENTION_MS);

    const counters = await getRunOutcomeCounters();
    const counted = (status: string) =>
      counters
        .filter((c) => c.status === status)
        .reduce((sum, c) => sum + c.count, 0);
    expect(
      counted("completed") + counted("errored") + (await liveRunCount()),
    ).toBe(4);
    expect(counted("completed")).toBe(3);
  });

  it("does not double count across repeated cleanup passes", async () => {
    const prunedAt = Date.now() - (COMPLETED_RETENTION_MS + 60_000);
    await terminalRun("completed", "done", prunedAt);

    await cleanupOldRuns(COMPLETED_RETENTION_MS, ERRORED_RETENTION_MS);
    await cleanupOldRuns(COMPLETED_RETENTION_MS, ERRORED_RETENTION_MS);

    expect(await getRunOutcomeCounters()).toEqual([
      {
        day: new Date(prunedAt).toISOString().slice(0, 10),
        status: "completed",
        terminalReason: "done",
        count: 1,
      },
    ]);
  });

  it("accumulates into an existing (day, status, reason) row instead of failing on the primary key", async () => {
    const prunedAt = Date.now() - (COMPLETED_RETENTION_MS + 60_000);
    const day = new Date(prunedAt).toISOString().slice(0, 10);
    await terminalRun("completed", "done", prunedAt);
    await cleanupOldRuns(COMPLETED_RETENTION_MS, ERRORED_RETENTION_MS);
    await terminalRun("completed", "done", prunedAt);
    await cleanupOldRuns(COMPLETED_RETENTION_MS, ERRORED_RETENTION_MS);

    expect(await getRunOutcomeCounters()).toEqual([
      { day, status: "completed", terminalReason: "done", count: 2 },
    ]);
  });

  it("counts errored runs only once their own longer retention expires", async () => {
    const prunedAt = Date.now() - (ERRORED_RETENTION_MS + 60_000);
    const day = new Date(prunedAt).toISOString().slice(0, 10);
    await terminalRun("errored", "error:stale_run", prunedAt);
    await terminalRun("aborted", "user_abort", prunedAt);

    await cleanupOldRuns(COMPLETED_RETENTION_MS, ERRORED_RETENTION_MS);

    expect(await liveRunCount()).toBe(0);
    const counters = await getRunOutcomeCounters();
    expect(counters).toContainEqual({
      day,
      status: "errored",
      terminalReason: "error:stale_run",
      count: 1,
    });
    expect(counters).toContainEqual({
      day,
      status: "aborted",
      terminalReason: "user_abort",
      count: 1,
    });
  });

  it("retains truncated runs on the failure window instead of pruning them as successes", async () => {
    const prunedAt = Date.now() - (COMPLETED_RETENTION_MS + 60_000);
    await terminalRun("truncated", "run_timeout", prunedAt);
    await terminalRun("truncated", "no_progress", prunedAt);
    await terminalRun("completed", "done", prunedAt);

    await cleanupOldRuns(COMPLETED_RETENTION_MS, ERRORED_RETENTION_MS);

    expect(await liveRunCount()).toBe(2);
    expect(await getRunOutcomeCounters()).toEqual([
      {
        day: new Date(prunedAt).toISOString().slice(0, 10),
        status: "completed",
        terminalReason: "done",
        count: 1,
      },
    ]);
  });

  it("counts truncated runs once their own longer retention expires", async () => {
    const prunedAt = Date.now() - (ERRORED_RETENTION_MS + 60_000);
    const day = new Date(prunedAt).toISOString().slice(0, 10);
    await terminalRun("truncated", "run_timeout", prunedAt);

    await cleanupOldRuns(COMPLETED_RETENTION_MS, ERRORED_RETENTION_MS);

    expect(await liveRunCount()).toBe(0);
    expect(await getRunOutcomeCounters()).toContainEqual({
      day,
      status: "truncated",
      terminalReason: "run_timeout",
      count: 1,
    });
  });

  it("filters by sinceDay", async () => {
    const oldAt = Date.now() - (ERRORED_RETENTION_MS + 60_000);
    const recentAt = Date.now() - (COMPLETED_RETENTION_MS + 60_000);
    await terminalRun("completed", "done", oldAt);
    await terminalRun("completed", "done", recentAt);
    await cleanupOldRuns(COMPLETED_RETENTION_MS, ERRORED_RETENTION_MS);

    const sinceDay = new Date(recentAt).toISOString().slice(0, 10);
    const counters = await getRunOutcomeCounters({ sinceDay });
    expect(counters).toEqual([
      { day: sinceDay, status: "completed", terminalReason: "done", count: 1 },
    ]);
  });
});

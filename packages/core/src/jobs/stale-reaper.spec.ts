import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

type ExecuteInput = string | { sql: string; args?: unknown[] };

const rawClient = {
  execute: vi.fn(async (input: ExecuteInput) => {
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

const {
  A2A_TASK_ABANDONED_ERROR_CODE,
  AUTOMATION_RUN_ABANDONED_ERROR_CODE,
  REAP_BATCH_LIMIT,
  REAP_INTERVAL_MS,
  reapStaleA2ATasks,
  reapStaleAutomationRuns,
  reapStaleWork,
  resetStaleWorkReapThrottle,
  STALE_A2A_TASK_AFTER_MS,
  STALE_AUTOMATION_RUN_AFTER_MS,
} = await import("./stale-reaper.js");
const { REMOTE_AUTOMATION_MAX_ACTIVE_MS } =
  await import("./remote-execution.js");
const { startAutomationRun } = await import("./run-history.js");

const HOUR = 60 * 60_000;
const NOW = Date.parse("2026-10-01T12:00:00.000Z");

async function insertRun(
  name: string,
  ageMs: number,
  status = "running",
): Promise<string> {
  const id = await startAutomationRun({
    owner: "alice@agent-native.test",
    automation: name,
    path: `jobs/${name}.md`,
    notificationEmail: "alice@agent-native.test",
  });
  await pglite
    .prepare(
      `UPDATE automation_runs SET started_at = ?, status = ? WHERE id = ?`,
    )
    .run(NOW - ageMs, status, id);
  return id;
}

async function runRow(id: string) {
  return (await pglite
    .prepare(
      `SELECT status, error, error_code, finished_at, failure_alert_state, failure_alerted FROM automation_runs WHERE id = ?`,
    )
    .get(id)) as {
    status: string;
    error: string | null;
    error_code: string | null;
    finished_at: number | null;
    failure_alert_state: string | null;
    failure_alerted: number;
  };
}

describe("reapStaleAutomationRuns", () => {
  it("never reaps a run that could still legitimately be active", () => {
    expect(STALE_AUTOMATION_RUN_AFTER_MS).toBeGreaterThan(
      REMOTE_AUTOMATION_MAX_ACTIVE_MS,
    );
  });

  it("closes only runs stuck past the longest legitimate runtime", async () => {
    const stuck = await insertRun(
      "stuck-run",
      STALE_AUTOMATION_RUN_AFTER_MS + HOUR,
    );
    const recent = await insertRun("recent-run", 2 * HOUR);
    const finished = await insertRun(
      "finished-run",
      STALE_AUTOMATION_RUN_AFTER_MS + HOUR,
      "success",
    );

    await expect(reapStaleAutomationRuns({ now: NOW })).resolves.toBe(1);

    const reaped = await runRow(stuck);
    expect(reaped.status).toBe("interrupted");
    expect(reaped.error_code).toBe(AUTOMATION_RUN_ABANDONED_ERROR_CODE);
    expect(reaped.error).toContain("No delivery was confirmed");
    expect(Number(reaped.finished_at)).toBe(NOW);
    expect((await runRow(recent)).status).toBe("running");
    expect((await runRow(finished)).status).toBe("success");
  });

  it("does not queue a failure alert for a run that stopped long ago", async () => {
    const id = await insertRun(
      "silent-reap",
      STALE_AUTOMATION_RUN_AFTER_MS + HOUR,
    );
    await reapStaleAutomationRuns({ now: NOW });
    const row = await runRow(id);
    expect(row.failure_alert_state).toBeNull();
    expect(Number(row.failure_alerted)).toBe(0);
  });

  it("works through a backlog in bounded batches and is idempotent", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      ids.push(
        await insertRun(
          `backlog-${i}`,
          STALE_AUTOMATION_RUN_AFTER_MS + (10 - i) * HOUR,
        ),
      );
    }

    await expect(reapStaleAutomationRuns({ now: NOW, limit: 3 })).resolves.toBe(
      3,
    );
    // Oldest first: the three furthest past the limit were closed.
    expect(
      (await Promise.all(ids.slice(0, 3).map(runRow))).map((r) => r.status),
    ).toEqual(["interrupted", "interrupted", "interrupted"]);
    expect((await runRow(ids[3]!)).status).toBe("running");

    await expect(reapStaleAutomationRuns({ now: NOW, limit: 3 })).resolves.toBe(
      3,
    );
    await expect(reapStaleAutomationRuns({ now: NOW, limit: 3 })).resolves.toBe(
      1,
    );
    await expect(reapStaleAutomationRuns({ now: NOW, limit: 3 })).resolves.toBe(
      0,
    );
  });

  it("caps a single pass at the default batch size", async () => {
    expect(REAP_BATCH_LIMIT).toBeLessThanOrEqual(100);
  });
});

describe("reapStaleA2ATasks", () => {
  async function insertTask(
    id: string,
    state: string,
    ageMs: number,
    updatedAgeMs = ageMs,
  ) {
    await pglite
      .prepare(
        `INSERT INTO a2a_tasks (id, context_id, status_state, status_timestamp, history, artifacts, owner_email, owner_scope, created_at, updated_at)
         VALUES (?, ?, ?, ?, '[]', '[]', 'alice@agent-native.test', '', ?, ?)`,
      )
      .run(
        id,
        `ctx-${id}`,
        state,
        new Date(NOW - ageMs).toISOString(),
        NOW - ageMs,
        NOW - updatedAgeMs,
      );
  }

  async function taskRow(id: string) {
    return (await pglite
      .prepare(
        `SELECT status_state, status_message FROM a2a_tasks WHERE id = ?`,
      )
      .get(id)) as { status_state: string; status_message: string | null };
  }

  it("treats an app without A2A tables as having nothing to reap", async () => {
    await expect(reapStaleA2ATasks({ now: NOW })).resolves.toBe(0);
  });

  it("fails abandoned tasks with a typed reason and leaves live ones alone", async () => {
    const { ensureTable } = await import("../a2a/task-store.js");
    await ensureTable();
    await insertTask(
      "old-processing",
      "processing",
      STALE_A2A_TASK_AFTER_MS + HOUR,
    );
    await insertTask(
      "old-submitted",
      "submitted",
      STALE_A2A_TASK_AFTER_MS + 5 * HOUR,
    );
    await insertTask("old-working", "working", STALE_A2A_TASK_AFTER_MS + HOUR);
    await insertTask("fresh", "processing", HOUR);
    await insertTask(
      "recently-touched",
      "processing",
      STALE_A2A_TASK_AFTER_MS + HOUR,
      HOUR,
    );
    await insertTask(
      "old-needs-input",
      "input-required",
      STALE_A2A_TASK_AFTER_MS + HOUR,
    );
    await insertTask("old-done", "completed", STALE_A2A_TASK_AFTER_MS + HOUR);

    await expect(reapStaleA2ATasks({ now: NOW })).resolves.toBe(3);

    for (const id of ["old-processing", "old-submitted", "old-working"]) {
      const row = await taskRow(id);
      expect(row.status_state).toBe("failed");
      expect(JSON.parse(row.status_message!)).toMatchObject({
        role: "agent",
        metadata: { errorCode: A2A_TASK_ABANDONED_ERROR_CODE },
      });
    }
    expect((await taskRow("fresh")).status_state).toBe("processing");
    expect((await taskRow("recently-touched")).status_state).toBe("processing");
    expect((await taskRow("old-needs-input")).status_state).toBe(
      "input-required",
    );
    expect((await taskRow("old-done")).status_state).toBe("completed");

    await expect(reapStaleA2ATasks({ now: NOW })).resolves.toBe(0);
  });

  it("is bounded per pass", async () => {
    for (let i = 0; i < 5; i += 1) {
      await insertTask(
        `bulk-${i}`,
        "submitted",
        STALE_A2A_TASK_AFTER_MS + HOUR,
      );
    }
    await expect(reapStaleA2ATasks({ now: NOW, limit: 2 })).resolves.toBe(2);
    await expect(reapStaleA2ATasks({ now: NOW, limit: 2 })).resolves.toBe(2);
    await expect(reapStaleA2ATasks({ now: NOW, limit: 2 })).resolves.toBe(1);
  });
});

describe("reapStaleWork", () => {
  beforeEach(() => resetStaleWorkReapThrottle());

  it("runs once per interval and says when it did not look", async () => {
    await expect(reapStaleWork({ now: NOW })).resolves.toMatchObject({
      failed: [],
    });
    await expect(reapStaleWork({ now: NOW + 1_000 })).resolves.toBeNull();
    await expect(
      reapStaleWork({ now: NOW + REAP_INTERVAL_MS }),
    ).resolves.toMatchObject({ failed: [] });
  });

  it("reports a failed sweep instead of a clean zero", async () => {
    const original = rawClient.execute.getMockImplementation()!;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    rawClient.execute.mockImplementation(async (input: ExecuteInput) => {
      if (
        typeof input !== "string" &&
        input.sql.includes("UPDATE automation_runs")
      ) {
        throw new Error("database unavailable");
      }
      return original(input);
    });
    try {
      const result = await reapStaleWork({ now: NOW });
      expect(result).toMatchObject({ failed: ["automation_runs"] });
      expect(errors).toHaveBeenCalled();
    } finally {
      rawClient.execute.mockImplementation(original);
      errors.mockRestore();
    }
  });
});

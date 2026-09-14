import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "./test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let failNextExecute: ((sql: string) => boolean) | null = null;

const db = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof input === "string" ? input : input.sql;
    if (failNextExecute?.(sql)) throw new Error("simulated write failure");
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const result = await pglite.query(sql, input.args ?? []);
    return {
      rows: Array.from(result.rows ?? []),
      rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
    };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => db,
  isProductionServerlessFunctionRuntime: () => false,
}));

const { reapAllStaleA2ATasks } = await import("./stale-task-sweep.js");
const { ensureTable, getTask } = await import("./task-store.js");

const MINUTE = 60_000;

async function insertTask(input: {
  id: string;
  state: string;
  ageMs: number;
  sinceTouchMs: number;
}) {
  const now = Date.now();
  await pglite.query(
    `INSERT INTO a2a_tasks
       (id, context_id, status_state, status_timestamp, history, artifacts,
        metadata, owner_email, owner_scope, idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, '[]', '[]', ?, ?, '', NULL, ?, ?)`,
    [
      input.id,
      `ctx-${input.id}`,
      input.state,
      new Date(now - input.ageMs).toISOString(),
      JSON.stringify({ __a2a_processor: { verifiedEmail: "a@example.com" } }),
      "a@example.com",
      now - input.ageMs,
      now - input.sinceTouchMs,
    ],
  );
}

async function stateOf(id: string): Promise<string | undefined> {
  const task = await getTask(id);
  return task?.status.state;
}

// `ensureTable` memoizes its init promise per module instance, so every test
// shares one database and resets rows instead of the connection.
beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureTable();
});

beforeEach(async () => {
  failNextExecute = null;
  db.execute.mockClear();
  await pglite.query(`DELETE FROM a2a_tasks`);
});

afterAll(async () => {
  await pglite.close();
});

describe("reapAllStaleA2ATasks", () => {
  it("scans behind an index rather than the whole task history", async () => {
    const { rows } = await pglite.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'a2a_tasks'`,
    );
    expect(rows.map((row: any) => row.indexname)).toContain(
      "idx_a2a_tasks_status_state_updated_at",
    );
  });

  it("fails the reported case: a task stuck at working with nobody polling it", async () => {
    // The Dispatch agent fired ask_app, the target never claimed the task, and
    // the agent's turn ended — so no `tasks/get` ever arrives to notice.
    await insertTask({
      id: "never-dispatched",
      state: "working",
      ageMs: 20 * MINUTE,
      sinceTouchMs: 20 * MINUTE,
    });

    const result = await reapAllStaleA2ATasks();

    expect(result).toEqual({ reaped: 1, failed: 0, truncated: false });
    expect(await stateOf("never-dispatched")).toBe("failed");
    const task = await getTask("never-dispatched");
    expect(JSON.stringify(task?.status.message)).toContain(
      "could not be started",
    );
  });

  it("fails a processing task whose worker died mid-run", async () => {
    await insertTask({
      id: "worker-died",
      state: "processing",
      ageMs: 20 * MINUTE,
      sinceTouchMs: 10 * MINUTE,
    });

    expect(await reapAllStaleA2ATasks()).toEqual({
      reaped: 1,
      failed: 0,
      truncated: false,
    });
    expect(await stateOf("worker-died")).toBe("failed");
    expect(
      JSON.stringify((await getTask("worker-died"))?.status.message),
    ).toContain("timed out");
  });

  it("fails a heartbeating processing task that blew its lifetime ceiling", async () => {
    await insertTask({
      id: "hung-await",
      state: "processing",
      ageMs: 45 * MINUTE,
      sinceTouchMs: 5_000,
    });

    expect((await reapAllStaleA2ATasks()).reaped).toBe(1);
    expect(await stateOf("hung-await")).toBe("failed");
    expect(
      JSON.stringify((await getTask("hung-await"))?.status.message),
    ).toContain("maximum run time");
  });

  it("leaves healthy in-flight work alone", async () => {
    await insertTask({
      id: "healthy-processing",
      state: "processing",
      ageMs: 8 * MINUTE,
      sinceTouchMs: 5_000,
    });
    // Still inside the queued lifetime: the pull path would refire this, so
    // the sweep must not steal it and fail it early.
    await insertTask({
      id: "recently-queued",
      state: "working",
      ageMs: 45_000,
      sinceTouchMs: 45_000,
    });
    await insertTask({
      id: "already-done",
      state: "completed",
      ageMs: 90 * MINUTE,
      sinceTouchMs: 90 * MINUTE,
    });

    expect(await reapAllStaleA2ATasks()).toEqual({
      reaped: 0,
      failed: 0,
      truncated: false,
    });
    expect(await stateOf("healthy-processing")).toBe("processing");
    expect(await stateOf("recently-queued")).toBe("working");
    expect(await stateOf("already-done")).toBe("completed");
  });

  it("counts a row that threw instead of reporting a clean pass", async () => {
    await insertTask({
      id: "write-explodes",
      state: "processing",
      ageMs: 20 * MINUTE,
      sinceTouchMs: 10 * MINUTE,
    });
    failNextExecute = (sql) =>
      sql.includes("UPDATE a2a_tasks") && sql.includes("'failed'");

    const result = await reapAllStaleA2ATasks();

    expect(result.reaped).toBe(0);
    expect(result.failed).toBe(1);
    expect(await stateOf("write-explodes")).toBe("processing");
  });

  it("reports truncation when more stuck rows remain than the batch cap", async () => {
    const now = Date.now();
    await pglite.query(
      `INSERT INTO a2a_tasks
         (id, context_id, status_state, status_timestamp, history, artifacts,
          metadata, owner_email, owner_scope, idempotency_key, created_at, updated_at)
       SELECT 'stuck-' || i, NULL, 'processing', ?, '[]', '[]', NULL,
              'a@example.com', '', NULL, ?, ?
       FROM generate_series(1, 201) AS i`,
      [new Date(now).toISOString(), now - 20 * MINUTE, now - 10 * MINUTE],
    );

    const result = await reapAllStaleA2ATasks();

    expect(result.truncated).toBe(true);
    expect(result.reaped).toBe(200);
    expect((await reapAllStaleA2ATasks()).truncated).toBe(false);
  });

  it("is a no-op on an app with no stuck tasks", async () => {
    expect(await reapAllStaleA2ATasks()).toEqual({
      reaped: 0,
      failed: 0,
      truncated: false,
    });
  });
});

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

let db: Awaited<ReturnType<typeof createTestPglite>>;
vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      if (typeof input === "string") {
        await db.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await db.query(input.sql, input.args ?? []);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
    transaction: <T>(
      fn: (tx: import("../db/client.js").DbExec) => Promise<T>,
    ) => db.transaction(fn),
  }),
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async (_table: string, _column: string, sql: string) => {
    await db.exec(sql);
    return true;
  },
  ensureIndexExists: async () => true,
  ensureTableExists: async (_name: string, sql: string) => {
    await db.exec(sql);
    return true;
  },
}));
const {
  ensureRunTables,
  getThreadPrivateHistoryState,
  recordThreadPrivateRun,
  cleanupOldRuns,
} = await import("./run-store.js");
beforeAll(async () => {
  db = await createTestPglite();
  await ensureRunTables();
});
afterAll(async () => {
  await db?.close();
});

it("finds an older private event beyond fifty later runs and fails on malformed event data", async () => {
  for (let i = 0; i < 55; i++) {
    await db.query(
      "INSERT INTO agent_runs (id, thread_id, status, started_at) VALUES (?, ?, 'completed', ?)",
      [`privacy-run-${i}`, "privacy-thread", i],
    );
    await db.query(
      "INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, 0, 0, ?)",
      [
        `privacy-run-${i}`,
        JSON.stringify(
          i === 0
            ? { type: "text", omitFromPersistedHistory: true }
            : { type: "done" },
        ),
      ],
    );
  }
  await expect(getThreadPrivateHistoryState("privacy-thread")).resolves.toEqual(
    {
      hasPrivateHistory: true,
      projectionPending: false,
      privateRunIds: ["privacy-run-0"],
    },
  );
  await expect(getThreadPrivateHistoryState("other-thread")).resolves.toEqual({
    hasPrivateHistory: false,
    projectionPending: false,
    privateRunIds: [],
  });
  await db.query(
    "UPDATE agent_run_events SET event_data = ? WHERE run_id = ?",
    ["invalid json", "privacy-run-0"],
  );
  await expect(
    getThreadPrivateHistoryState("privacy-thread"),
  ).rejects.toThrow();
  await expect(getThreadPrivateHistoryState("other-thread")).resolves.toEqual({
    hasPrivateHistory: false,
    projectionPending: false,
    privateRunIds: [],
  });
});

it("retains private provenance after old runs and events are cleaned up", async () => {
  await db.query(
    "INSERT INTO agent_runs (id, thread_id, status, started_at, completed_at) VALUES (?, ?, 'completed', 1, 1)",
    ["retained-private-run", "retained-private-thread"],
  );
  await db.query(
    "INSERT INTO agent_run_events (run_id, seq, event_at, event_data) VALUES (?, 0, 1, ?)",
    [
      "retained-private-run",
      JSON.stringify({ type: "text", omitFromPersistedHistory: true }),
    ],
  );
  await recordThreadPrivateRun(
    "retained-private-thread",
    "retained-private-run",
  );
  await cleanupOldRuns(1);
  expect(
    (
      await db.query("SELECT id FROM agent_runs WHERE id = ?", [
        "retained-private-run",
      ])
    ).rows,
  ).toHaveLength(0);
  await expect(
    getThreadPrivateHistoryState("retained-private-thread"),
  ).resolves.toEqual({
    hasPrivateHistory: true,
    projectionPending: false,
    privateRunIds: ["retained-private-run"],
  });
});

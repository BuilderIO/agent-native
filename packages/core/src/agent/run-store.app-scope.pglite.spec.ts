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
const { ensureRunTables, listRecentRunsForOwner } =
  await import("./run-store.js");
beforeAll(async () => {
  db = await createTestPglite();
  await ensureRunTables();
  for (const [id, owner, app] of [
    ["local", "a@example.test", "app-a"],
    ["foreign", "a@example.test", "app-b"],
    ["legacy", "a@example.test", null],
    ["other-owner", "b@example.test", "app-a"],
  ]) {
    await db.query(
      "INSERT INTO chat_threads (id, title, owner_email, source_app_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)",
      [id, id, owner, app],
    );
  }
  await db.query(
    "INSERT INTO agent_runs (id, thread_id, status, started_at) VALUES ('local-run', 'local', 'completed', 1)",
  );
  for (let i = 0; i < 30; i++) {
    await db.query(
      "INSERT INTO agent_runs (id, thread_id, status, started_at) VALUES (?, ?, 'completed', ?)",
      [`foreign-run-${i}`, "foreign", i + 10],
    );
  }
  for (const id of ["legacy", "other-owner"]) {
    await db.query(
      "INSERT INTO agent_runs (id, thread_id, status, started_at) VALUES (?, ?, 'completed', 100)",
      [id, id],
    );
  }
});
afterAll(async () => {
  await db?.close();
});
it("scopes before the limit and retains the same-app owner row", async () => {
  expect(
    (
      await listRecentRunsForOwner(" A@example.test ", 5, {
        sourceAppId: "app-a",
      })
    ).map((run) => run.id),
  ).toEqual(["local-run"]);
});
it.each([null, "", "  "])(
  "fails closed for an unknown local app %s",
  async (sourceAppId) => {
    expect(
      await listRecentRunsForOwner("a@example.test", 5, { sourceAppId }),
    ).toEqual([]);
  },
);
it("keeps explicit internal aggregate listing and its owner boundary", async () => {
  const runs = await listRecentRunsForOwner("a@example.test", 25);
  expect(runs).toHaveLength(25);
  expect(runs.some((run) => run.id === "legacy")).toBe(true);
  expect(runs.some((run) => run.id === "other-owner")).toBe(false);
});

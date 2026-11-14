import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";

const db = await createTestPglite();
vi.mock("../../db/client.js", () => ({
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
      fn: (tx: import("../../db/client.js").DbExec) => Promise<T>,
    ) => db.transaction(fn),
  }),
  isProductionServerlessFunctionRuntime: () => false,
}));

const { ensureAgentHarnessSessionTables, listAgentHarnessSessions } =
  await import("./store.js");
const scope = {
  ownerEmail: "owner@example.test",
  orgId: "org-a",
  sourceAppId: "app-a",
};
beforeAll(async () => {
  await ensureAgentHarnessSessionTables();
  await db.exec(
    "CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY, source_app_id TEXT, owner_email TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)",
  );
  for (const [id, appId, ownerEmail, orgId] of [
    ["local", "app-a", scope.ownerEmail, scope.orgId],
    ["legacy", null, scope.ownerEmail, scope.orgId],
    ["other-owner", "app-a", "other@example.test", scope.orgId],
    ["other-org", "app-a", scope.ownerEmail, "org-b"],
  ]) {
    await db.query(
      "INSERT INTO chat_threads (id, source_app_id, owner_email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)",
      [`thread-${id}`, appId, ownerEmail],
    );
    await db.query(
      "INSERT INTO agent_harness_sessions (id, thread_id, harness_name, run_id, owner_email, org_id, status, created_at, updated_at) VALUES (?, ?, 'test', ?, ?, ?, 'running', 1, 100)",
      [id, `thread-${id}`, `run-${id}`, ownerEmail, orgId],
    );
  }
  await db.query(
    "UPDATE agent_harness_sessions SET updated_at = 1 WHERE id = 'local'",
  );
  for (let i = 0; i < 60; i++) {
    await db.query(
      "INSERT INTO chat_threads (id, source_app_id, owner_email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)",
      [`foreign-thread-${i}`, "app-b", scope.ownerEmail],
    );
    await db.query(
      "INSERT INTO agent_harness_sessions (id, thread_id, harness_name, run_id, owner_email, org_id, status, created_at, updated_at) VALUES (?, ?, 'test', ?, ?, ?, 'running', 1, ?)",
      [
        `foreign-${i}`,
        `foreign-thread-${i}`,
        `foreign-run-${i}`,
        scope.ownerEmail,
        scope.orgId,
        200 + i,
      ],
    );
  }
});
afterAll(async () => {
  await db?.close();
});

it("filters by app before the 50-session storage limit", async () => {
  expect(
    (await listAgentHarnessSessions(scope)).map((session) => session.id),
  ).toEqual(["local"]);
});
it.each([null, "", "   "])(
  "fails closed for missing local identity %s",
  async (sourceAppId) => {
    expect(await listAgentHarnessSessions({ ...scope, sourceAppId })).toEqual(
      [],
    );
  },
);
it("retains the explicit aggregate query and foreign-app rows without exposing another owner", async () => {
  const sessions = await listAgentHarnessSessions({
    ownerEmail: scope.ownerEmail,
    orgId: scope.orgId,
    limit: 200,
  });
  expect(sessions).toHaveLength(62);
  expect(sessions.some((session) => session.id === "legacy")).toBe(true);
  expect(sessions.some((session) => session.id === "foreign-59")).toBe(true);
  expect(sessions.some((session) => session.id === "other-owner")).toBe(false);
  expect(sessions.some((session) => session.id === "other-org")).toBe(false);
});
it("keeps thread and status restrictions inside a local query", async () => {
  expect(
    await listAgentHarnessSessions({ ...scope, threadId: "thread-legacy" }),
  ).toEqual([]);
  expect(await listAgentHarnessSessions({ ...scope, status: "idle" })).toEqual(
    [],
  );
  expect(
    (
      await listAgentHarnessSessions({
        ...scope,
        threadId: "thread-local",
        status: "running",
      })
    ).map((session) => session.id),
  ).toEqual(["local"]);
});

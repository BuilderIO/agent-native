import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDbExec, getDbExec } from "../db/client.js";
import { splitSqlStatements } from "../db/migrations.js";
import { defineStore } from "../db/store-registry.js";
import { withExecutionFence } from "./execution-fence.js";
import { AGENT_RUN_MIGRATIONS } from "./run-migrations.js";
import {
  agentRunsStore,
  beginAgentExecutionStep,
  claimTurnExecutionLease,
  completeAgentExecutionStep,
  ensureRunTables,
  insertRun,
  markAgentExecutionStepDispatched,
  type AgentExecutionStepIntent,
} from "./run-store.js";

const previousUrl = process.env.DATABASE_URL;

beforeEach(async () => {
  await closeDbExec();
  process.env.DATABASE_URL = "pglite:memory";
});

afterAll(async () => {
  await closeDbExec();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});

async function initializedLocalDatabase() {
  await getDbExec().execute(`CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    started_at BIGINT NOT NULL, completed_at BIGINT
  )`);
  await getDbExec().execute(`INSERT INTO agent_runs
    (id, thread_id, started_at) VALUES ('old-run', 'old-thread', 1)`);
  await defineStore({
    id: "agent_runs",
    migrations: agentRunsStore.migrations.filter(
      (migration) =>
        migration.name === "baseline" || migration.name === "widen-bigint",
    ),
  }).ready();
  expect(
    (
      await getDbExec().execute(
        "SELECT name FROM _an_store_migrations WHERE store_id = 'agent_runs' ORDER BY name",
      )
    ).rows.map((row) => row.name),
  ).toEqual(["baseline", "widen-bigint"]);
}

async function exerciseExecution() {
  await insertRun("new-run", "thread", "turn");
  const fence = await claimTurnExecutionLease("thread", "turn", "new-run");
  expect(fence.generation).toBe("1");
  const intent: AgentExecutionStepIntent = {
    ...fence,
    stepId: "step",
    operationId: "operation",
    toolName: "test-read",
    inputJson: "{}",
    replayPolicy: "read-only",
  };
  await withExecutionFence(fence, async () => {
    expect(await beginAgentExecutionStep(intent)).toEqual({
      status: "execute",
      wasDispatched: false,
    });
    await markAgentExecutionStepDispatched(intent);
    await completeAgentExecutionStep(intent, '{"ok":true}');
    expect(await beginAgentExecutionStep(intent)).toEqual({
      status: "completed",
      resultJson: '{"ok":true}',
      errorJson: null,
    });
  });
  expect(
    (
      await getDbExec().execute(
        "SELECT worker_generation FROM agent_runs WHERE id = 'new-run'",
      )
    ).rows,
  ).toEqual([{ worker_generation: 1 }]);
}

describe("agent run local schema readiness", () => {
  it("upgrades a recorded local baseline before claiming a lease and storing a step", async () => {
    await initializedLocalDatabase();
    await ensureRunTables();
    expect(
      (
        await getDbExec().execute(
          "SELECT name, source FROM _an_store_migrations WHERE store_id = 'agent_runs' ORDER BY name",
        )
      ).rows,
    ).toEqual([
      { name: "baseline", source: "step" },
      { name: "execution-leases-and-steps", source: "step" },
      { name: "widen-bigint", source: "step" },
    ]);
    expect(
      (
        await getDbExec().execute(
          "SELECT worker_generation FROM agent_runs WHERE id = 'old-run'",
        )
      ).rows,
    ).toEqual([{ worker_generation: null }]);
    expect(
      (
        await getDbExec().execute(`SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'agent_execution_steps_pending_idx'`)
      ).rows,
    ).toHaveLength(1);
    await exerciseExecution();
  });

  it("keeps existing lease and step data when release v8 and local readiness both run again", async () => {
    await initializedLocalDatabase();
    const v8 = AGENT_RUN_MIGRATIONS.find(
      (migration) => migration.version === 8,
    )!;
    if (typeof v8.sql !== "string") throw new Error("Expected release v8 SQL");
    for (const statement of splitSqlStatements(v8.sql))
      await getDbExec().execute(statement);
    await ensureRunTables();
    await exerciseExecution();
    const before = (
      await getDbExec().execute("SELECT * FROM agent_execution_steps")
    ).rows;
    const localSql = agentRunsStore.migrations.find(
      (migration) => migration.name === "execution-leases-and-steps",
    )?.sql;
    if (!localSql) throw new Error("Expected local execution schema SQL");
    for (const statement of typeof localSql === "string"
      ? [localSql]
      : localSql) {
      await getDbExec().execute(statement);
    }
    for (const statement of splitSqlStatements(v8.sql))
      await getDbExec().execute(statement);
    agentRunsStore.reset();
    await ensureRunTables();
    expect(
      (await getDbExec().execute("SELECT * FROM agent_execution_steps")).rows,
    ).toEqual(before);
    expect(
      (
        await getDbExec().execute(
          "SELECT generation, owner_run_id FROM agent_execution_leases",
        )
      ).rows,
    ).toEqual([{ generation: 1, owner_run_id: "new-run" }]);
  });

  it("provisions execution on a fresh local database", async () => {
    await ensureRunTables();
    await exerciseExecution();
  });
});

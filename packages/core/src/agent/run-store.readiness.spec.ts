import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import {
  closeDbExec,
  getDbExec,
  withDbExec,
  type DbExec,
} from "../db/client.js";
import { invalidateSchemaSnapshot } from "../db/ddl-guard.js";
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

afterEach(() => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
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
    await exerciseExecution();
    expect(
      (
        await getDbExec().execute(
          "SELECT name, source FROM _an_store_migrations WHERE store_id = 'agent_runs' ORDER BY name",
        )
      ).rows,
    ).toEqual([
      { name: "agent-run-admission-order", source: "step" },
      {
        name: "agent-run-harness-transcript-order-runtime-schema",
        source: "step",
      },
      { name: "baseline", source: "step" },
      { name: "execution-leases-and-steps", source: "step" },
      {
        name: "thread-projection-retry-quarantine-runtime-schema",
        source: "step",
      },
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
    const repair = agentRunsStore.migrations.find(
      (migration) => migration.name === "execution-leases-and-steps",
    );
    if (!repair?.run)
      throw new Error("Expected local execution schema migration");
    await repair.run(getDbExec());
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

  it("repairs a snapshot database recorded before the projection retry columns existed", async () => {
    const exec = getDbExec();
    // The shape a database installed by the previous release's snapshot has:
    // every agent_runs column except the two the skipped legacy entries
    // v10/v11 add, and a ledger that records every migration of that
    // release — so only the runtime stand-in for v10/v11 is left to run.
    await exec.execute(`CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      abort_reason TEXT,
      started_at BIGINT NOT NULL,
      completed_at BIGINT,
      heartbeat_at BIGINT,
      last_progress_at BIGINT,
      turn_id TEXT,
      error_code TEXT,
      error_detail TEXT,
      terminal_reason TEXT,
      dispatch_mode TEXT,
      diag_stage TEXT,
      worker_stage TEXT,
      dispatch_payload TEXT,
      peak_rss_mb BIGINT,
      in_flight_since BIGINT,
      continuation_order BIGINT,
      auto_continue_of TEXT,
      thread_projection_pending BOOLEAN NOT NULL DEFAULT FALSE
    )`);
    await exec.execute(`CREATE TABLE agent_run_events (
      run_id TEXT NOT NULL,
      seq BIGINT NOT NULL,
      event_at BIGINT,
      event_data TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    )`);
    await exec.execute(`CREATE TABLE agent_run_outcome_daily (
      day TEXT NOT NULL,
      status TEXT NOT NULL,
      terminal_reason TEXT NOT NULL DEFAULT '',
      run_count BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (day, status, terminal_reason)
    )`);
    await exec.execute(`CREATE TABLE agent_tool_ledger (
      thread_id TEXT NOT NULL,
      tool_key TEXT NOT NULL,
      result_summary TEXT NOT NULL,
      result_is_string BOOLEAN,
      artifacts_json TEXT,
      chat_ui_result_json TEXT,
      completed_at BIGINT NOT NULL,
      PRIMARY KEY (thread_id, tool_key)
    )`);
    await exec.execute(`CREATE TABLE agent_turn_initiators (
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      principal_email TEXT NOT NULL,
      auth_user_id TEXT,
      org_id TEXT,
      org_scope TEXT,
      is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
      first_run_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (thread_id, turn_id)
    )`);
    await exec.execute(`INSERT INTO agent_runs
      (id, thread_id, started_at, thread_projection_pending)
      VALUES ('pending-run', 'thread', 1, TRUE), ('plain-run', 'thread', 2, FALSE)`);
    await exec.execute(`CREATE TABLE _an_store_migrations (
      store_id TEXT NOT NULL,
      name TEXT NOT NULL,
      applied_at BIGINT NOT NULL,
      checksum TEXT,
      kind TEXT,
      source TEXT,
      core_version TEXT,
      PRIMARY KEY (store_id, name)
    )`);
    const recordedBySnapshot = [
      "baseline",
      "widen-bigint",
      "agent-run-base-tables",
      "agent-run-liveness-and-diagnostics-columns",
      "agent-run-continuation-order",
      "agent-tool-ledger-result-type",
      "agent-tool-ledger-chat-ui-result",
      "agent-run-auto-continue-of",
      "agent-tool-ledger-arguments-hash",
      "agent-turn-execution-leases-and-steps",
      "agent-run-thread-projection-retry",
      "agent-run-thread-projection-retry-fairness",
      "agent-run-thread-projection-quarantine",
      "agent-run-harness-transcript-order-runtime-schema",
      "agent-run-admission-order",
      "execution-leases-and-steps",
    ];
    for (const name of recordedBySnapshot) {
      await exec.execute({
        sql: `INSERT INTO _an_store_migrations
          (store_id, name, applied_at, checksum, kind, source)
          VALUES ('agent_runs', ?, 1, NULL, 'schema', 'snapshot')`,
        args: [name],
      });
    }

    await ensureRunTables();

    expect(
      (
        await exec.execute(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'agent_runs'
             AND column_name IN ('thread_projection_retry_order', 'thread_projection_error_code')
           ORDER BY column_name`,
        )
      ).rows.map((row) => row.column_name),
    ).toEqual([
      "thread_projection_error_code",
      "thread_projection_retry_order",
    ]);
    expect(
      (
        await exec.execute(
          `SELECT indexname FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'agent_runs_thread_projection_retry_order_idx'`,
        )
      ).rows,
    ).toHaveLength(1);
    // The v10 backfill reaches rows already waiting on projection.
    expect(
      (
        await exec.execute(
          `SELECT id, thread_projection_retry_order FROM agent_runs ORDER BY id`,
        )
      ).rows,
    ).toEqual([
      { id: "pending-run", thread_projection_retry_order: 1 },
      { id: "plain-run", thread_projection_retry_order: null },
    ]);
    expect(
      (
        await exec.execute(
          `SELECT source FROM _an_store_migrations
           WHERE store_id = 'agent_runs'
             AND name = 'thread-projection-retry-quarantine-runtime-schema'`,
        )
      ).rows,
    ).toEqual([{ source: "step" }]);
  });
});

function hostedRuntime(releaseOwned = false) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NETLIFY", "true");
  vi.stubEnv("AGENT_NATIVE_RELEASE_MIGRATIONS", releaseOwned ? "1" : "0");
  resetAppConfigForTests();
  agentRunsStore.reset();
  invalidateSchemaSnapshot();
}

function recordingExecutor(base: DbExec) {
  const statements: string[] = [];
  function wrap(client: DbExec): DbExec {
    return {
      async execute(statement) {
        statements.push(
          typeof statement === "string" ? statement : statement.sql,
        );
        return client.execute(statement);
      },
      ...(client.transaction
        ? {
            transaction: <T>(run: (tx: DbExec) => Promise<T>) =>
              client.transaction!((tx) => run(wrap(tx))),
          }
        : {}),
    };
  }
  return { executor: wrap(base), statements };
}

const executionSchemaDdl = (statements: string[]) =>
  statements.filter(
    (sql) =>
      /^\s*(?:CREATE|ALTER|DROP|LOCK)\b/i.test(sql) &&
      /\bagent_execution_\w*\b|\bworker_generation\b/i.test(sql),
  );

describe("agent run hosted schema readiness", () => {
  it("replays a provisioned store in each cold process without execution schema DDL or ledger access", async () => {
    await ensureRunTables();
    await exerciseExecution();
    const base = getDbExec();
    const before = (await base.execute("SELECT * FROM agent_execution_steps"))
      .rows;
    for (let process = 0; process < 2; process++) {
      hostedRuntime();
      const { executor, statements } = recordingExecutor(base);
      await withDbExec(executor, () => ensureRunTables());
      expect(
        statements.some((sql) => sql.includes("information_schema.columns")),
      ).toBe(true);
      expect(statements.some((sql) => sql.includes("pg_indexes"))).toBe(true);
      expect(executionSchemaDdl(statements)).toEqual([]);
      expect(
        statements.some((sql) => sql.includes("_an_store_migration")),
      ).toBe(false);
    }
    expect(
      (await base.execute("SELECT * FROM agent_execution_steps")).rows,
    ).toEqual(before);
  });

  it.each([false, true])(
    "repairs a missing column in hosted-replay with execution tables present=%s, then replays without execution schema DDL",
    async (tablesPresent) => {
      await initializedLocalDatabase();
      const base = getDbExec();
      if (tablesPresent) {
        const v8 = AGENT_RUN_MIGRATIONS.find(
          (migration) => migration.version === 8,
        )!;
        if (typeof v8.sql !== "string")
          throw new Error("Expected release v8 SQL");
        for (const statement of splitSqlStatements(v8.sql)) {
          if (!statement.startsWith("ALTER TABLE"))
            await base.execute(statement);
        }
      }
      hostedRuntime();
      const first = recordingExecutor(base);
      await withDbExec(first.executor, () => ensureRunTables());
      expect(
        executionSchemaDdl(first.statements).map((sql) =>
          sql.replace(/\s+/g, " ").trim(),
        ),
      ).toEqual(
        tablesPresent
          ? [
              "ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS worker_generation BIGINT",
            ]
          : [
              expect.stringMatching(
                /^CREATE TABLE IF NOT EXISTS agent_execution_leases/,
              ),
              "ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS worker_generation BIGINT",
              expect.stringMatching(
                /^CREATE TABLE IF NOT EXISTS agent_execution_steps/,
              ),
              expect.stringMatching(
                /^CREATE INDEX IF NOT EXISTS agent_execution_steps_pending_idx/,
              ),
            ],
      );
      expect(
        first.statements.some((sql) => sql.includes("_an_store_migration")),
      ).toBe(false);
      expect(
        (
          await base.execute(
            "SELECT worker_generation FROM agent_runs WHERE id = 'old-run'",
          )
        ).rows,
      ).toEqual([{ worker_generation: null }]);
      await withDbExec(first.executor, () => exerciseExecution());
      hostedRuntime();
      const second = recordingExecutor(base);
      await withDbExec(second.executor, () => ensureRunTables());
      expect(executionSchemaDdl(second.statements)).toEqual([]);
      expect(
        (
          await base.execute(
            "SELECT name FROM _an_store_migrations WHERE store_id = 'agent_runs' ORDER BY name",
          )
        ).rows,
      ).toEqual([{ name: "baseline" }, { name: "widen-bigint" }]);
    },
  );

  it.each([
    [
      "table agent_execution_leases",
      "information_schema.tables",
      "agent_execution_leases",
    ],
    [
      "column agent_runs.worker_generation",
      "information_schema.columns",
      "worker_generation",
    ],
    [
      "index agent_execution_steps_pending_idx",
      "pg_indexes",
      "agent_execution_steps_pending_idx",
    ],
  ])(
    "rejects an unreadable %s probe without execution schema DDL",
    async (label, source, name) => {
      await ensureRunTables();
      const base = getDbExec();
      hostedRuntime();
      const statements: string[] = [];
      const executor: DbExec = {
        async execute(statement) {
          const sql = typeof statement === "string" ? statement : statement.sql;
          statements.push(sql);
          // Fail batched introspection and the targeted fallback probe.
          if (
            sql.includes("SELECT table_name, column_name") ||
            (sql.includes(source) &&
              typeof statement !== "string" &&
              statement.args?.includes(name))
          ) {
            throw new Error("schema catalog unavailable");
          }
          return base.execute(statement);
        },
      };
      await expect(
        withDbExec(executor, () => ensureRunTables()),
      ).rejects.toThrow(`could not probe required schema "${label}"`);
      expect(executionSchemaDdl(statements)).toEqual([]);
      expect(
        statements.some((sql) => sql.includes("_an_store_migration")),
      ).toBe(false);
    },
  );

  it("trusts a release-owned hosted store without any database access", async () => {
    const execute = vi.fn<DbExec["execute"]>();
    hostedRuntime(true);
    await withDbExec({ execute }, () => ensureRunTables());
    expect(execute).not.toHaveBeenCalled();
  });
});

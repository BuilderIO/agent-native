import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetAppConfigForTests } from "../../app-config/index.js";
import {
  closeDbExec,
  getDbExec,
  withDbExec,
  type DbExec,
} from "../../db/client.js";
import {
  ensureTableExists,
  invalidateSchemaSnapshot,
} from "../../db/ddl-guard.js";
import { splitSqlStatements } from "../../db/migrations.js";
import {
  __setSchemaSnapshotForTests,
  defineStore,
  type SchemaSnapshot,
} from "../../db/store-registry.js";
import { AGENT_HARNESS_SESSION_MIGRATIONS } from "./migrations.js";
import {
  agentHarnessSessionsStore,
  ensureAgentHarnessSessionTables,
  listExpiredAgentHarnessApprovalResolutions,
  listExpiredAgentHarnessFollowUps,
  saveAgentHarnessSession,
} from "./store.js";

const previousUrl = process.env.DATABASE_URL;
const dirs: string[] = [];
const COLUMNS = ["approval_resolution_id", "expiry_cleanup_id"];
const REPAIR = "agent-harness-sessions-approval-and-expiry-columns";

// Every core from 0.210 to 0.220 installed this snapshot: the harness table at
// legacy v4, with `baseline` recorded, so neither the edited baseline nor the
// release-only v6/v7 ever reach the database in local dev.
const legacyUpToV4 = AGENT_HARNESS_SESSION_MIGRATIONS.filter(
  (migration) => migration.version <= 4,
);
const SNAPSHOT_BEFORE_0_221: SchemaSnapshot = {
  statements: legacyUpToV4.flatMap((migration) =>
    splitSqlStatements(
      typeof migration.sql === "string"
        ? migration.sql
        : migration.sql.postgres,
    ),
  ),
  tables: ["agent_harness_sessions"],
  migrations: [
    ["agent_harness_sessions", "baseline", null],
    ...legacyUpToV4.map(
      (migration) =>
        [
          "agent_harness_sessions",
          migration.name ?? `v${migration.version}`,
          null,
        ] as const,
    ),
  ],
  bootLists: [],
};

beforeEach(async () => {
  await closeDbExec();
  // A directory, not memory: closing the client must keep the database, as a
  // process restart does.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-readiness-"));
  dirs.push(dir);
  process.env.DATABASE_URL = `pglite:${dir}`;
  agentHarnessSessionsStore.reset();
  invalidateSchemaSnapshot();
  __setSchemaSnapshotForTests(SNAPSHOT_BEFORE_0_221);
});

afterEach(() => {
  __setSchemaSnapshotForTests(undefined);
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

afterAll(async () => {
  await closeDbExec();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function harnessColumns(exec: DbExec = getDbExec()) {
  const { rows } = await exec.execute({
    sql: `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'agent_harness_sessions' AND column_name IN (?, ?)
      ORDER BY column_name`,
    args: COLUMNS,
  });
  return rows.map((row) => row.column_name);
}

async function useHarnessSessions() {
  await saveAgentHarnessSession({
    id: "session-1",
    harnessName: "harness",
    threadId: "thread-1",
  });
  await listExpiredAgentHarnessApprovalResolutions();
  await listExpiredAgentHarnessFollowUps();
}

describe("agent harness local schema readiness", () => {
  it("adds the approval and expiry columns to a database a pre-0.221 snapshot installed", async () => {
    await ensureAgentHarnessSessionTables();
    expect(await harnessColumns()).toEqual(COLUMNS);
    await useHarnessSessions();
  });

  it("adds the columns when a rolled-back caller transaction ran the repair first", async () => {
    // The database already booted a core without the repair.
    await defineStore({
      id: "agent_harness_sessions",
      migrations: agentHarnessSessionsStore.migrations.filter(
        (migration) => migration.name !== REPAIR,
      ),
    }).ready();
    expect(await harnessColumns()).toEqual([]);
    await closeDbExec();

    await expect(
      getDbExec().transaction!((tx) =>
        withDbExec(tx, async () => {
          await ensureAgentHarnessSessionTables();
          // Any later schema probe in the same transaction sees the columns.
          await ensureTableExists(
            "_an_store_migrations",
            "CREATE TABLE IF NOT EXISTS _an_store_migrations (id TEXT)",
          );
          throw new Error("caller rollback");
        }),
      ),
    ).rejects.toThrow("caller rollback");
    expect(await harnessColumns()).toEqual([]);

    agentHarnessSessionsStore.reset();
    await ensureAgentHarnessSessionTables();
    expect(await harnessColumns()).toEqual(COLUMNS);
    await useHarnessSessions();
  });
});

describe("agent harness hosted schema readiness", () => {
  it("replays a provisioned store without DDL on the approval and expiry columns", async () => {
    await ensureAgentHarnessSessionTables();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("AGENT_NATIVE_RELEASE_MIGRATIONS", "0");
    resetAppConfigForTests();
    agentHarnessSessionsStore.reset();
    invalidateSchemaSnapshot();
    const base = getDbExec();
    const statements: string[] = [];
    // raw-sql-ok: a recording executor that forwards each statement unchanged.
    const recording: DbExec = {
      execute(statement) {
        statements.push(
          typeof statement === "string" ? statement : statement.sql,
        );
        return base.execute(statement);
      },
    };

    await withDbExec(recording, () => ensureAgentHarnessSessionTables());

    expect(
      statements.filter(
        (sql) =>
          /^\s*(?:CREATE|ALTER|DROP|LOCK)\b/i.test(sql) &&
          COLUMNS.some((column) => sql.includes(column)),
      ),
    ).toEqual([]);
    expect(statements.some((sql) => sql.includes("_an_store_migration"))).toBe(
      false,
    );
  });
});

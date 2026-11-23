import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  organizations,
  orgMembers,
  ORG_MIGRATIONS,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { upsertWorkspaceConnection } from "@agent-native/core/workspace-connections";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import { readCellOutput } from "../server/model/runs-store.js";
import runCell from "./run-project-cell.js";

/*
 * Real multi-connection Postgres (PGlite serializes transactions on one
 * connection and cannot show a lock wait), with the warehouse call mocked so a
 * dependent query's provider response can be held. The race is at the FINAL
 * commit: the dependent query has already judged its query-driven input and
 * reserved its run when an editor takes the project lock and changes the
 * source; the provider response then arrives while the editor still holds the
 * lock. The check that the source is unchanged must run after that lock is
 * acquired, so the stale commit is refused. A throwaway cluster is started
 * from locally installed binaries; the file is skipped visibly where none is.
 */

const provider = vi.hoisted(() => vi.fn());
vi.mock("../server/model/data-connections.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/model/data-connections.js")
  >()),
  defaultDataConnectionId: vi.fn().mockResolvedValue(null),
  executeConnectionQuery: provider,
  canReadConnectionResults: vi.fn().mockResolvedValue(true),
  assertDataframeConnectionAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../server/lib/project-action-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/project-action-access.js")
  >()),
  assertGrantedDataConnection: vi.fn().mockResolvedValue(undefined),
}));

function binary(name: string): string | null {
  for (const dir of [
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/lib/postgresql/18/bin",
  ]) {
    const candidate = join(dir, name);
    if (spawnSync(candidate, ["--version"]).status === 0) return candidate;
  }
  return null;
}

const initdb = binary("initdb");
const pgCtl = binary("pg_ctl");
const createdb = binary("createdb");
const available = !!(initdb && pgCtl && createdb);

const round = mkdtempSync(join(tmpdir(), "dynamic-lock-"));
const previousDatabase = process.env.DATABASE_URL;
const email = "dyn-owner@example.test";
const orgId = `qa-dyn-lock-${randomUUID()}`;
const scope = { ownerEmail: email, orgId };
const context = {
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId: "analytics-2",
};
const actor = <T>(call: () => T) =>
  runWithRequestContext(
    { userEmail: email, orgId, isSyntheticTraffic: true },
    call,
  );
let url = "";
let started = false;

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolvePort(address.port)
          : reject(new Error("No port")),
      );
    });
  });
}

const shared = {
  kind: "sql" as const,
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
  dataConnectionId: "qa-connection",
  databaseSchema: null,
  outputResult: true,
};

const warehouse = (
  column: string,
  rows: string[][],
  overrides: Record<string, unknown> = {},
) => ({
  jobComplete: true,
  status: "complete",
  jobReference: { projectId: "qa-warehouse", jobId: "qa-job" },
  columns: [{ name: column, type: "STRING" }],
  rows,
  totalRows: String(rows.length),
  pageToken: null,
  hasNextPage: false,
  totalBytesProcessed: "0",
  ...overrides,
});

beforeEach(() => provider.mockReset());

async function fixture() {
  const sourceId = `cell-${randomUUID()}`;
  const inputId = `cell-${randomUUID()}`;
  const targetId = `cell-${randomUUID()}`;
  const project = await createProject({
    ...scope,
    title: "Dynamic lock",
    cells: [
      {
        ...shared,
        id: sourceId,
        source: "SELECT code FROM codes",
        resultVariable: "segs",
      },
      {
        id: inputId,
        kind: "input" as const,
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        name: "seg",
        inputType: "DROPDOWN" as const,
        defaultValueString: "",
        options: [],
        optionsSource: { dataframe: "segs", valueColumn: "code" },
      },
      {
        ...shared,
        id: targetId,
        source: "SELECT '{{ seg }}' AS selected",
        resultVariable: "picked",
      },
    ],
  });
  provider.mockResolvedValueOnce(warehouse("code", [["a"], ["b"]]));
  await actor(() =>
    runCell.run({ projectId: project.id, cellId: sourceId }, context),
  );
  // An earlier result for the dependent query, which a refused commit must keep.
  provider.mockResolvedValueOnce(warehouse("selected", [["before"]]));
  await actor(() =>
    runCell.run({ projectId: project.id, cellId: targetId }, context),
  );
  return { projectId: project.id, sourceId, targetId };
}

async function blockedOnProjectLock(): Promise<boolean> {
  const probe = postgres(url, { max: 1 });
  try {
    const rows = await probe`SELECT 1 FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND datname = 'locks'
        AND query ILIKE '%analytics2_projects%'`;
    return rows.length > 0;
  } finally {
    await probe.end();
  }
}

type Change = (
  tx: postgres.TransactionSql,
  ids: { projectId: string; sourceId: string },
) => Promise<void>;

/**
 * Runs the dependent query with its provider response held, lets an editor take
 * the project lock and apply `change` uncommitted, releases the response while
 * the editor still holds the lock, and waits until the commit is blocked on the
 * project row. Every resource it opens is released and settled in `finally`.
 */
async function raceAtFinalCommit(change: Change) {
  const { projectId, sourceId, targetId } = await fixture();
  let respond: (value: unknown) => void = () => undefined;
  provider.mockImplementationOnce(
    () =>
      new Promise((resolveResponse) => {
        respond = resolveResponse;
      }),
  );
  const calls = provider.mock.calls.length;
  const editor = postgres(url, { max: 1 });
  let finish: () => void = () => undefined;
  const editorHeld = new Promise<void>((resolveHeld) => {
    finish = resolveHeld;
  });
  let editing: Promise<unknown> | undefined;
  let pending: Promise<unknown> | undefined;
  let outcome: { ok: true } | { ok: false; error: unknown } | undefined;
  try {
    pending = actor(() =>
      runCell.run({ projectId, cellId: targetId }, context),
    ).then(
      () => (outcome = { ok: true }),
      (error: unknown) => (outcome = { ok: false, error }),
    );
    // The dependent query has judged its input and reserved its run: its
    // warehouse request is now in flight.
    await vi.waitFor(() => expect(provider.mock.calls.length).toBe(calls + 1), {
      timeout: 20_000,
      interval: 50,
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolveLocked) => {
      locked = resolveLocked;
    });
    editing = editor.begin(async (tx) => {
      await tx`SELECT id FROM analytics2_projects WHERE id = ${projectId} FOR UPDATE`;
      await change(tx, { projectId, sourceId });
      locked();
      await editorHeld;
    });
    await lockTaken;
    // The response arrives while the editor still holds the lock.
    respond(warehouse("selected", [["after"]]));
    await vi.waitFor(
      async () => expect(await blockedOnProjectLock()).toBe(true),
      {
        timeout: 20_000,
        interval: 100,
      },
    );
    expect(outcome).toBeUndefined();
  } finally {
    respond(warehouse("selected", [["after"]]));
    finish();
    await editing?.catch(() => undefined);
    await editor.end({ timeout: 5 }).catch(() => undefined);
    await pending;
  }
  return { projectId, targetId, outcome };
}

beforeAll(async () => {
  if (!available || !initdb || !pgCtl || !createdb) return;
  const data = join(round, "data");
  const port = await freePort();
  execFileSync(initdb, ["-D", data, "-A", "trust", "-U", "postgres"], {
    stdio: "ignore",
  });
  execFileSync(
    pgCtl,
    [
      "-D",
      data,
      "-w",
      "-o",
      `-p ${port} -c unix_socket_directories= -c listen_addresses=127.0.0.1`,
      "start",
    ],
    { stdio: "ignore" },
  );
  started = true;
  execFileSync(
    createdb,
    ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "locks"],
    { stdio: "ignore" },
  );
  url = `postgres://postgres@127.0.0.1:${port}/locks`;
  process.env.DATABASE_URL = url;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_dyn_lock_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "Lock workspace",
    createdBy: email,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email,
    role: "owner",
    joinedAt: Date.now(),
  });
  await actor(() =>
    upsertWorkspaceConnection({
      id: "qa-connection",
      provider: "bigquery",
      label: "QA test warehouse",
      status: "connected",
      allowedApps: ["analytics-2"],
      config: { viewAccessGroupIds: [] },
    }),
  );
});

afterAll(async () => {
  await closeDbExec();
  if (started && pgCtl)
    spawnSync(pgCtl, ["-D", join(round, "data"), "-m", "immediate", "stop"], {
      stdio: "ignore",
    });
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round);
  if (owned.startsWith(resolve(tmpdir()) + "/dynamic-lock-"))
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside the owned dynamic-lock round");
});

// oracle-change: the file skips visibly only where no local Postgres server binaries exist, as the other pg suite does
describe.skipIf(!available)(
  "a query-driven input and the final commit's project lock",
  () => {
    it("commits the new result when nothing about the source changed while the commit waited", async () => {
      const { projectId, targetId, outcome } = await raceAtFinalCommit(
        async () => {},
      );
      expect(outcome).toEqual({ ok: true });
      expect(
        (await readCellOutput(scope, projectId, targetId))?.output,
      ).toMatchObject({ type: "table", rows: [["after"]] });
    }, 90_000);

    it.each([
      [
        "its query is edited",
        async (
          tx: postgres.TransactionSql,
          ids: { projectId: string; sourceId: string },
        ) => {
          const [row] = await tx`SELECT contents FROM analytics2_cells
          WHERE project_id = ${ids.projectId} AND id = ${ids.sourceId}`;
          const contents = JSON.parse(String(row.contents));
          contents.source = "SELECT code FROM codes WHERE 1 = 1";
          await tx`UPDATE analytics2_cells SET contents = ${JSON.stringify(contents)}
          WHERE project_id = ${ids.projectId} AND id = ${ids.sourceId}`;
        },
      ],
      [
        "its saved result is replaced",
        async (
          tx: postgres.TransactionSql,
          ids: { projectId: string; sourceId: string },
        ) => {
          await tx`UPDATE analytics2_cell_outputs
          SET ran_at = ${new Date(Date.now() + 60_000).toISOString()}
          WHERE project_id = ${ids.projectId} AND cell_id = ${ids.sourceId}`;
        },
      ],
    ])(
      "refuses the stale commit and keeps the earlier result when the source's %s while the commit waits",
      async (_name, change) => {
        const { projectId, targetId, outcome } =
          await raceAtFinalCommit(change);
        expect(outcome).toMatchObject({ ok: false });
        expect(
          outcome && !outcome.ok
            ? (outcome.error as { errorCode?: string })
            : null,
        ).toMatchObject({ errorCode: "project_query_changed" });
        // The response that arrived after the change was not written.
        expect(
          (await readCellOutput(scope, projectId, targetId))?.output,
        ).toMatchObject({ type: "table", rows: [["before"]] });
      },
      90_000,
    );
  },
);

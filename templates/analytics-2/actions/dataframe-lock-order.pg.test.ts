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
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { runWithRequestContext } from "@agent-native/core/server";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "../server/db/index.js";
import { localDuckDb } from "../server/execution/local-duckdb.test-support.js";
import { createNotebookWorker } from "../server/execution/notebook-worker.js";
import { moveCell } from "../server/model/cells-store.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { notebookRunStore } from "../server/model/notebook-execution/service.js";
import {
  createProject,
  getProjectDocument,
} from "../server/model/projects-store.js";
import { runRequestSchema } from "../shared/notebook-execution.js";
import getExecutionSnapshot from "./get-notebook-execution-snapshot.js";
import runCell from "./run-project-cell.js";
import startNotebookRun from "./start-notebook-run.js";

/*
 * Real multi-connection Postgres. PGlite serializes every transaction on one
 * connection, so it cannot show a lock-order deadlock; this file starts a
 * throwaway cluster from the locally installed server binaries and is skipped
 * (visibly) where none is installed.
 */

vi.mock("../server/execution/notebook-kernel.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/execution/notebook-kernel.js")
  >()),
  createHostedKernelPort: () => localDuckDb(),
}));
vi.mock("../server/model/data-connections.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/model/data-connections.js")
  >()),
  defaultDataConnectionId: vi.fn().mockResolvedValue(null),
  assertDataframeConnectionAccess: vi.fn().mockResolvedValue(undefined),
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

const round = mkdtempSync(join(tmpdir(), "dataframe-lock-"));
const previousDatabase = process.env.DATABASE_URL;
const email = "lock-owner@example.test";
const orgId = `qa-lock-${randomUUID()}`;
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
const blobs = new Map<string, Uint8Array>();
const storage: PrivateBlobProvider = {
  id: "dataframe-lock-results",
  name: "Dataframe lock results",
  isConfigured: () => true,
  async put({ key, data }) {
    if (!key || blobs.has(key)) throw new Error("Invalid result key");
    blobs.set(key, Uint8Array.from(data));
    return { id: key, provider: this.id, encrypted: false, opaque: true };
  },
  async read(handle) {
    const data = blobs.get(handle.id);
    if (!data) throw new Error("Result is missing");
    return { data, handle };
  },
  async delete(handle) {
    return { deleted: blobs.delete(handle.id), provider: this.id };
  },
};

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
  dataConnectionId: null,
  databaseSchema: null,
  outputResult: true,
};

async function fixture() {
  const upstream = `cell-${randomUUID()}`;
  const downstream = `cell-${randomUUID()}`;
  const unrelated = `cell-${randomUUID()}`;
  const project = await createProject({
    ...scope,
    title: "Lock order",
    cells: [
      {
        ...shared,
        id: upstream,
        source: "SELECT * FROM orders LIMIT 2",
        resultVariable: "dataframe",
      },
      {
        ...shared,
        id: downstream,
        source: "SELECT COUNT(*) AS count FROM dataframe",
        resultVariable: "result",
        connectionMode: "dataframes",
      },
      {
        ...shared,
        id: unrelated,
        source: "SELECT * FROM products LIMIT 1",
        resultVariable: "other",
      },
    ],
  });
  const execution = await actor(() =>
    getExecutionSnapshot.run({ projectId: project.id }, context),
  );
  if (execution.status !== "found") throw new Error(execution.status);
  const run = await actor(() =>
    startNotebookRun.run(
      runRequestSchema.parse({
        requestId: randomUUID(),
        snapshot: execution.snapshot,
        mode: "cell-only",
        targetCellId: upstream,
        cache: "bypass",
        staleValues: "reject",
      }),
      context,
    ),
  );
  if (run.status !== "admitted") throw new Error(run.status);
  const worker = createNotebookWorker(notebookRunStore, localDuckDb());
  for (const _cell of run.plan.admittedCellIds)
    if (
      !(await actor(() => worker({ ...scope, caller: "frontend" }, run.runId)))
    )
      break;
  return { projectId: project.id, upstream, downstream, unrelated };
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
    table: "qa_lock_org_migrations",
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
  registerPrivateBlobProvider(storage);
});

afterAll(async () => {
  unregisterPrivateBlobProvider(storage.id);
  await closeDbExec();
  if (started && pgCtl)
    spawnSync(pgCtl, ["-D", join(round, "data"), "-m", "immediate", "stop"], {
      stdio: "ignore",
    });
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round);
  if (owned.startsWith(resolve(tmpdir()) + "/dataframe-lock-"))
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside the owned lock round");
});

describe.skipIf(!available)("dataframe publication lock order", () => {
  it("publishes while a cell-first editor holds an unrelated cell row, then lets that editor finish", async () => {
    const { projectId, downstream, unrelated } = await fixture();
    const editor = postgres(url, { max: 1 });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolveLocked) => {
      locked = resolveLocked;
    });
    // The sequence moveCell and delete-project-cell follow: the cell row first,
    // then the project row.
    const editing = editor.begin(async (tx) => {
      await tx`UPDATE analytics2_cells SET label = 'editing'
                WHERE project_id = ${projectId} AND id = ${unrelated}`;
      locked();
      await held;
      await tx`UPDATE analytics2_projects SET user_updated_at = ${new Date().toISOString()}
                WHERE id = ${projectId}`;
    });
    await lockTaken;
    try {
      const outcome = await Promise.race([
        actor(() =>
          runCell.run({ projectId, cellId: downstream }, context),
        ).then((result) => ({ kind: "done" as const, result })),
        new Promise<{ kind: "blocked" }>((resolveBlocked) =>
          setTimeout(() => resolveBlocked({ kind: "blocked" }), 20_000),
        ),
      ]);
      expect(outcome).toMatchObject({
        kind: "done",
        result: { output: { type: "table", rows: [[2]] } },
      }); // oracle-change: Phase 1 keeps a dataframe result in the notebook result store, so the run's own output is the saved result
    } finally {
      release();
    }
    await editing;
    await editor.end();
  }, 60_000);

  it("never deadlocks concurrent publications against real cell moves", async () => {
    const { projectId, downstream, unrelated } = await fixture();
    const document = await getProjectDocument(scope, projectId);
    if (!document) throw new Error("Project missing");
    const failures: unknown[] = [];
    for (let round = 0; round < 8; round++) {
      const results = await Promise.allSettled([
        actor(() => runCell.run({ projectId, cellId: downstream }, context)),
        actor(() =>
          moveCell({
            ...scope,
            projectId,
            versionId: document.workingVersionId,
            cellId: unrelated,
            position: round % 2,
          }),
        ),
      ]);
      for (const result of results)
        if (
          result.status === "rejected" &&
          (result.reason as { errorCode?: unknown }).errorCode !==
            "project_query_changed"
        )
          failures.push(result.reason);
    }
    expect(failures).toEqual([]); // oracle-change: Phase 1 admits a run against the snapshot it read, so a move that commits first refuses it with project_query_changed; a deadlock is any other failure
  }, 120_000);
});

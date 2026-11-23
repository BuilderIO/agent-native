import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "./database.js";
import {
  registerOutputDataframe,
  sweepDataframeBlobs,
} from "./dataframe-lifecycle.js";

function binary(name: string) {
  for (const dir of [
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/lib/postgresql/18/bin",
  ]) {
    const path = join(dir, name);
    if (spawnSync(path, ["--version"]).status === 0) return path;
  }
  return null;
}
const initdb = binary("initdb"),
  pgCtl = binary("pg_ctl"),
  createdb = binary("createdb");
const available = !!(initdb && pgCtl && createdb);
const dir = mkdtempSync(join(tmpdir(), "dataframe-register-lock-"));
const previous = process.env.DATABASE_URL;
const scope = { ownerEmail: "lock@example.test", orgId: "lock-org" };
let url = "",
  started = false;
async function port() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("No port")),
      );
    });
  });
}
beforeAll(async () => {
  if (!initdb || !pgCtl || !createdb) return;
  const p = await port();
  execFileSync(
    initdb,
    ["-D", join(dir, "data"), "-A", "trust", "-U", "postgres"],
    { stdio: "ignore" },
  );
  execFileSync(
    pgCtl,
    [
      "-D",
      join(dir, "data"),
      "-w",
      "-o",
      `-p ${p} -c unix_socket_directories= -c listen_addresses=127.0.0.1`,
      "start",
    ],
    { stdio: "ignore" },
  );
  started = true;
  execFileSync(
    createdb,
    ["-h", "127.0.0.1", "-p", String(p), "-U", "postgres", "locks"],
    { stdio: "ignore" },
  );
  url = `postgres://postgres@127.0.0.1:${p}/locks`;
  process.env.DATABASE_URL = url;
  await ensureAnalyticsDatabase();
});
afterAll(async () => {
  await closeDbExec();
  if (started && pgCtl)
    spawnSync(pgCtl, ["-D", join(dir, "data"), "-m", "immediate", "stop"], {
      stdio: "ignore",
    });
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
  rmSync(dir, { recursive: true, force: true });
});
describe.skipIf(!available)("dataframe registration lock", () => {
  it("preserves a publication that races the sweeper", async () => {
    const projectId = randomUUID();
    const id = randomUUID();
    const handle = {
      provider: "test",
      id,
      opaque: true as const,
      encrypted: true as const,
    };
    const output = {
      type: "table" as const,
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      materialization: {
        version: 1 as const,
        handle,
        snapshot: "a".repeat(64),
        digest: "b".repeat(64),
        dependencies: [],
      },
    };
    await getDb()
      .insert(schema.projects)
      .values({
        id: projectId,
        ...scope,
        workingVersionId: "work",
        createdAt: "now",
        updatedAt: "now",
      });
    await getDb()
      .insert(schema.dataframeBlobs)
      .values({
        provider: handle.provider,
        handleId: id,
        ...scope,
        projectId,
        handleJson: JSON.stringify(handle),
        createdAt: "now",
      });
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const locked = new Promise<void>((r) => {
      ready = r;
    });
    const publication = getDb().transaction(async (tx) => {
      await registerOutputDataframe(tx, scope, projectId, output);
      ready();
      await held;
      await tx.insert(schema.cellOutputs).values({
        projectId,
        cellId: id,
        status: "complete",
        output: JSON.stringify(output),
        ranAt: "now",
      });
    });
    await locked;
    const sweeping = sweepDataframeBlobs(scope, projectId);
    const observer = postgres(url, { max: 1 });
    try {
      await expect
        .poll(
          async () => {
            const rows =
              await observer`SELECT 1 FROM pg_stat_activity WHERE datname = 'locks' AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
            return rows.length > 0;
          },
          { interval: 10, timeout: 1000 },
        )
        .toBe(true);
    } finally {
      release();
    }
    await publication;
    expect(await sweeping).toEqual({ removed: 0 });
    expect(
      (
        await getDb()
          .select()
          .from(schema.dataframeBlobs)
          .where(eq(schema.dataframeBlobs.handleId, id))
      )[0]?.state,
    ).toBe("live");
    await observer.end();
  });
  it("holds the ledger lock until publication commits", async () => {
    const projectId = randomUUID(),
      id = randomUUID();
    const handle = {
      provider: "test",
      id,
      opaque: true as const,
      encrypted: true as const,
    };
    await getDb()
      .insert(schema.projects)
      .values({
        id: projectId,
        ...scope,
        workingVersionId: "work",
        createdAt: "now",
        updatedAt: "now",
      });
    await getDb()
      .insert(schema.dataframeBlobs)
      .values({
        provider: handle.provider,
        handleId: id,
        ...scope,
        projectId,
        handleJson: JSON.stringify(handle),
        createdAt: "now",
      });
    const sql = postgres(url, { max: 1 });
    let unlock!: () => void, locked!: () => void;
    const held = new Promise<void>((r) => {
      unlock = r;
    });
    const ready = new Promise<void>((r) => {
      locked = r;
    });
    const output = {
      type: "table" as const,
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      materialization: {
        version: 1 as const,
        handle,
        snapshot: "a".repeat(64),
        digest: "b".repeat(64),
        dependencies: [],
      },
    };
    const registering = getDb().transaction(async (tx) => {
      await registerOutputDataframe(tx, scope, projectId, output);
      locked();
      await held;
      await tx.insert(schema.cellOutputs).values({
        projectId,
        cellId: id,
        status: "complete",
        output: JSON.stringify(output),
        ranAt: "now",
      });
    });
    await ready;
    const marking =
      sql`UPDATE analytics2_dataframe_blobs SET state = 'deleting' WHERE handle_id = ${id}`.execute();
    const observer = postgres(url, { max: 1 });
    try {
      await expect
        .poll(
          async () => {
            const rows =
              await observer`SELECT 1 FROM pg_stat_activity WHERE datname = 'locks' AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
            return rows.length > 0;
          },
          { interval: 10, timeout: 1000 },
        )
        .toBe(true);
    } finally {
      unlock();
    }
    await registering;
    await marking;
    expect(
      await getDb()
        .select()
        .from(schema.cellOutputs)
        .where(eq(schema.cellOutputs.cellId, id)),
    ).toHaveLength(1);
    await observer.end();
    await sql.end();
  });
});

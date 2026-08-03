// guard:allow-unscoped — in-memory test fixture, not a request path.
import { createClient, type Client } from "@libsql/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real in-memory sqlite behind getDbExec: the bug class this replaces was
// "the sweep selected the wrong population", so the reaper's population has to
// be exercised against a real table rather than an asserted SQL string.
let sqlite: Client;

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => sqlite,
  isPostgres: () => false,
}));

vi.mock("../db/index.js", () => ({
  getDb: () => {
    throw new Error("renewUploadLease is covered by the route tests");
  },
  schema: { recordings: {} },
}));

const { reapExpiredUploads, UPLOAD_LEASE_EXPIRED_REASON, uploadLeaseExpiry } =
  await import("./upload-lease.js");

const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

async function insertRecording(row: {
  id: string;
  status: string;
  lease?: string | null;
  updatedAt?: string;
}) {
  await sqlite.execute({
    sql: `INSERT INTO recordings (id, owner_email, status, upload_lease_expires_at, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      row.id,
      "owner@example.com",
      row.status,
      row.lease ?? null,
      row.updatedAt ?? iso(-60_000),
    ],
  });
}

async function insertChunk(recordingId: string, index: number) {
  await sqlite.execute({
    sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
    args: [
      `recording-chunks-${recordingId}-${String(index).padStart(6, "0")}`,
      "{}",
    ],
  });
}

async function chunkKeys(): Promise<string[]> {
  const { rows } = await sqlite.execute(
    `SELECT key FROM application_state WHERE key LIKE 'recording-chunks-%' ORDER BY key`,
  );
  return rows.map((row: any) => String(row.key));
}

async function statusOf(id: string) {
  const { rows } = await sqlite.execute({
    sql: `SELECT status, failure_reason FROM recordings WHERE id = ?`,
    args: [id],
  });
  const row = rows[0] as any;
  return { status: row?.status, failure_reason: row?.failure_reason };
}

describe("upload lease", () => {
  beforeEach(async () => {
    sqlite = createClient({ url: ":memory:" });
    await sqlite.execute(`CREATE TABLE recordings (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      status TEXT NOT NULL,
      failure_reason TEXT,
      upload_lease_expires_at TEXT,
      upload_generation_id TEXT,
      updated_at TEXT NOT NULL
    )`);
    await sqlite.execute(`CREATE TABLE application_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  });

  it("leaves a leased, actively-uploading recording alone", async () => {
    await insertRecording({
      id: "live",
      status: "uploading",
      lease: iso(30_000),
    });
    await insertChunk("live", 0);
    await insertChunk("live", 1);

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.expired).toEqual([]);
    expect(result.failed).toBe(0);
    expect((await statusOf("live")).status).toBe("uploading");
    // A live upload's scratch is claimed by its in-progress row and survives.
    expect(await chunkKeys()).toEqual([
      "recording-chunks-live-000000",
      "recording-chunks-live-000001",
    ]);
  });

  it("fails an upload whose lease expired and reclaims its scratch", async () => {
    await insertRecording({
      id: "dead",
      status: "uploading",
      lease: iso(-1_000),
    });
    await insertChunk("dead", 0);

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.failed).toBe(1);
    expect(result.expired.map((row) => row.id)).toEqual(["dead"]);
    expect(await statusOf("dead")).toEqual({
      status: "failed",
      failure_reason: UPLOAD_LEASE_EXPIRED_REASON,
    });
    expect(await chunkKeys()).toEqual([]);
  });

  it("removes the generation-scoped session for a reaped upload", async () => {
    await insertRecording({
      id: "fenced-dead",
      status: "uploading",
      lease: iso(-1_000),
    });
    await sqlite.execute({
      sql: `UPDATE recordings SET upload_generation_id = ? WHERE id = ?`,
      args: ["generation-1", "fenced-dead"],
    });
    await sqlite.execute({
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: ["resumable-session-fenced-dead-generation-1", "{}"],
    });
    await sqlite.execute({
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: ["resumable-session-fenced-dead", "{}"],
    });

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.failed).toBe(1);
    const { rows } = await sqlite.execute({
      sql: `SELECT key FROM application_state WHERE key LIKE ? ORDER BY key`,
      args: ["resumable-session-fenced-dead%"],
    });
    expect(rows.map((row) => String(row.key))).toEqual([
      "resumable-session-fenced-dead",
    ]);
  });

  it("reaches a long-stuck 'processing' recording that no upload session tracks", async () => {
    await insertRecording({
      id: "stuck",
      status: "processing",
      lease: iso(-25 * 60 * 60 * 1000),
    });

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.failed).toBe(1);
    expect((await statusOf("stuck")).status).toBe("failed");
  });

  it("leaves a recording whose lease is renewed mid-reap fully intact", async () => {
    await insertRecording({
      id: "renewing",
      status: "uploading",
      lease: iso(-1_000),
    });
    await insertChunk("renewing", 0);
    await sqlite.execute({
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: ["resumable-session-renewing", "{}"],
    });

    // The writer renews between the reaper's probe and its compare-and-set.
    const realExecute = sqlite.execute.bind(sqlite);
    let renewed = false;
    vi.spyOn(sqlite, "execute").mockImplementation(async (stmt: any) => {
      const sql = typeof stmt === "string" ? stmt : stmt.sql;
      if (!renewed && /^\s*UPDATE recordings/i.test(sql)) {
        renewed = true;
        await realExecute({
          sql: `UPDATE recordings SET upload_lease_expires_at = ? WHERE id = ?`,
          args: [iso(60 * 60 * 1000), "renewing"],
        });
      }
      return realExecute(stmt);
    });

    const result = await reapExpiredUploads({ now: NOW });

    expect(renewed).toBe(true);
    expect(result.failed).toBe(0);
    expect(result.expired).toEqual([]);
    expect((await statusOf("renewing")).status).toBe("uploading");
    // Its streaming session must survive too — losing it strands the upload
    // just as thoroughly as failing the row would.
    const { rows } = await realExecute(
      `SELECT key FROM application_state WHERE key = 'resumable-session-renewing'`,
    );
    expect(rows).toHaveLength(1);
    expect(await chunkKeys()).toEqual(["recording-chunks-renewing-000000"]);
  });

  it("reclaims scratch left by finalized and hard-deleted recordings", async () => {
    await insertRecording({ id: "done", status: "ready", lease: iso(30_000) });
    await insertChunk("done", 0);
    await insertChunk("gone", 0); // recording row was hard-deleted

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.failed).toBe(0);
    expect(result.scratchKeysDeleted).toBe(2);
    expect(await chunkKeys()).toEqual([]);
  });

  it("reports without writing on a dry run, and is idempotent when re-run", async () => {
    await insertRecording({
      id: "dead",
      status: "uploading",
      lease: iso(-1_000),
    });
    await insertChunk("dead", 0);

    const dry = await reapExpiredUploads({ now: NOW, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.expired.map((row) => row.id)).toEqual(["dead"]);
    expect(dry.failed).toBe(0);
    expect((await statusOf("dead")).status).toBe("uploading");
    expect(await chunkKeys()).toHaveLength(1);

    await reapExpiredUploads({ now: NOW });
    const second = await reapExpiredUploads({ now: NOW });
    expect(second.expired).toEqual([]);
    expect(second.failed).toBe(0);
    expect(second.scratchKeysDeleted).toBe(0);
  });

  it("ignores a recording with no lease instead of guessing from updated_at", async () => {
    await insertRecording({
      id: "unleased",
      status: "uploading",
      lease: null,
      updatedAt: iso(-90 * 24 * 60 * 60 * 1000),
    });

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.failed).toBe(0);
    expect((await statusOf("unleased")).status).toBe("uploading");
  });

  it("writes lease expiries in one comparable encoding", () => {
    expect(uploadLeaseExpiry(NOW)).toBe("2026-07-25T13:00:00.000Z");
    expect(uploadLeaseExpiry(NOW) > uploadLeaseExpiry(NOW - 1_000)).toBe(true);
  });
});

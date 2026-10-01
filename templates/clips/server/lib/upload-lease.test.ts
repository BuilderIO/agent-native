// guard:allow-unscoped - test fixture, not a request path.
import { createRequire } from "node:module";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
let db: ReturnType<typeof drizzle>;
let client: PGliteClient;
type SqlStatement = string | { sql: string; args?: unknown[] };

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => "$" + ++index);
}

async function execute(db: PGliteClient, statement: SqlStatement) {
  if (typeof statement === "string") {
    const results = [];
    for (const sql of statement
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean)) {
      results.push(await db.query(postgresSql(sql)));
    }
    return results[results.length - 1];
  }
  const result = await db.query(
    postgresSql(statement.sql),
    statement.args ?? [],
  );
  return { ...result, rowsAffected: result.affectedRows };
}

const mockAbortResumableUploadSession = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({
    execute: (statement: SqlStatement) => execute(client, statement),
  }),
}));

vi.mock("../db/index.js", async () => {
  const schema = await import("../db/schema.js");
  return { getDb: () => db, schema };
});

vi.mock("./resumable-upload-cleanup.js", () => ({
  abortResumableUploadSession: (...args: unknown[]) =>
    mockAbortResumableUploadSession(...args),
}));

const {
  reapExpiredUploads,
  renewUploadLease,
  UPLOAD_LEASE_EXPIRED_REASON,
  uploadLeaseExpiry,
} = await import("./upload-lease.js");

const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

async function insertRecording(row: {
  id: string;
  status: string;
  lease?: string | null;
  updatedAt?: string;
}) {
  await execute(client, {
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
  await execute(client, {
    sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
    args: [
      `recording-chunks-${recordingId}-${String(index).padStart(6, "0")}`,
      "{}",
    ],
  });
}

async function chunkKeys(): Promise<string[]> {
  const { rows } = await execute(
    client,
    `SELECT key FROM application_state WHERE key LIKE 'recording-chunks-%' ORDER BY key`,
  );
  return rows.map((row: any) => String(row.key));
}

async function statusOf(id: string) {
  const { rows } = await execute(client, {
    sql: `SELECT status, failure_reason, failure_code FROM recordings WHERE id = ?`,
    args: [id],
  });
  const row = rows[0] as any;
  return {
    status: row?.status,
    failure_reason: row?.failure_reason,
    failure_code: row?.failure_code,
  };
}

describe("upload lease", () => {
  beforeEach(async () => {
    client = await PGlite.create("memory://");
    db = drizzle(client);
    mockAbortResumableUploadSession.mockResolvedValue(true);
    await execute(
      client,
      `CREATE TABLE recordings (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      status TEXT NOT NULL,
      upload_attempt_id TEXT,
      recording_platform TEXT,
      failure_code TEXT,
      failure_reason TEXT,
      upload_lease_expires_at TEXT,
      upload_progress INTEGER NOT NULL DEFAULT 0,
      upload_generation_id TEXT,
      loom_import_claim_id TEXT,
      loom_import_claimed_at TEXT,
      video_url TEXT,
      video_size_bytes INTEGER,
      duration_ms INTEGER,
      updated_at TEXT NOT NULL
    )`,
    );
    await execute(
      client,
      `CREATE TABLE application_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    );
  });

  it("renews only the owned processing Loom claim", async () => {
    await insertRecording({
      id: "loom-claim",
      status: "processing",
      lease: iso(-1_000),
    });
    await execute(client, {
      sql: `UPDATE recordings SET loom_import_claim_id = ?, loom_import_claimed_at = ? WHERE id = ?`,
      args: ["claim-current", iso(-30_000), "loom-claim"],
    });

    const wrongClaim = await renewUploadLease("loom-claim", {
      now: NOW,
      ownerEmail: "owner@example.com",
      loomImportClaimId: "claim-old",
    });
    expect(wrongClaim).toMatchObject({ held: false, status: "processing" });

    const wrongOwner = await renewUploadLease("loom-claim", {
      now: NOW,
      ownerEmail: "other@example.com",
      loomImportClaimId: "claim-current",
    });
    expect(wrongOwner).toMatchObject({ held: false, status: null });

    const { rows: unchangedRows } = await execute(client, {
      sql: `SELECT upload_lease_expires_at, loom_import_claimed_at FROM recordings WHERE id = ?`,
      args: ["loom-claim"],
    });
    expect(unchangedRows[0]).toMatchObject({
      upload_lease_expires_at: iso(-1_000),
      loom_import_claimed_at: iso(-30_000),
    });

    const renewed = await renewUploadLease("loom-claim", {
      now: NOW,
      ownerEmail: "OWNER@example.com",
      loomImportClaimId: "claim-current",
    });
    expect(renewed).toEqual({ held: true });
    const { rows: renewedRows } = await execute(client, {
      sql: `SELECT upload_lease_expires_at, loom_import_claimed_at FROM recordings WHERE id = ?`,
      args: ["loom-claim"],
    });
    expect(renewedRows[0]).toMatchObject({
      upload_lease_expires_at: uploadLeaseExpiry(NOW),
      loom_import_claimed_at: iso(0),
    });

    await insertRecording({
      id: "loom-uploading",
      status: "uploading",
      lease: iso(-1_000),
    });
    await execute(client, {
      sql: `UPDATE recordings SET loom_import_claim_id = ? WHERE id = ?`,
      args: ["claim-uploading", "loom-uploading"],
    });
    const wrongStatus = await renewUploadLease("loom-uploading", {
      now: NOW,
      ownerEmail: "owner@example.com",
      loomImportClaimId: "claim-uploading",
    });
    expect(wrongStatus).toMatchObject({ held: false, status: "uploading" });
    const { rows: unchangedUploadingRows } = await execute(client, {
      sql: `SELECT upload_lease_expires_at FROM recordings WHERE id = ?`,
      args: ["loom-uploading"],
    });
    expect(unchangedUploadingRows[0]?.upload_lease_expires_at).toBe(
      iso(-1_000),
    );
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
      failure_code: "upload_timed_out",
    });
    expect(await chunkKeys()).toEqual([]);
  });

  it("removes the generation-scoped session for a reaped upload", async () => {
    await insertRecording({
      id: "fenced-dead",
      status: "uploading",
      lease: iso(-1_000),
    });
    await execute(client, {
      sql: `UPDATE recordings SET upload_generation_id = ? WHERE id = ?`,
      args: ["generation-1", "fenced-dead"],
    });
    await execute(client, {
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: [
        "resumable-session-fenced-dead-generation-1",
        JSON.stringify({
          providerId: "s3",
          sessionId: "remote-dead",
          meta: { objectKey: "clips/fenced-dead.webm" },
          bytesUploaded: 10,
        }),
      ],
    });
    await execute(client, {
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: ["resumable-session-fenced-dead", "{}"],
    });

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.failed).toBe(1);
    const { rows } = await execute(client, {
      sql: `SELECT key FROM application_state WHERE key LIKE ? ORDER BY key`,
      args: ["resumable-session-fenced-dead%"],
    });
    expect(
      rows.map((row: { key?: unknown }) =>
        typeof row.key === "string" ? row.key : "",
      ),
    ).toEqual(["resumable-session-fenced-dead"]);
    expect(result.resumableSessionsAborted).toBe(1);
    expect(mockAbortResumableUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "s3",
        sessionId: "remote-dead",
      }),
      expect.objectContaining({ label: "upload-reaper-fenced-dead" }),
    );
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
    await execute(client, {
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: ["resumable-session-renewing", "{}"],
    });

    const realQuery = client.query.bind(client);
    let renewed = false;
    vi.spyOn(client, "query").mockImplementation(
      async (...queryArgs: unknown[]) => {
        const [sql, args] = queryArgs;
        if (
          typeof sql === "string" &&
          !renewed &&
          /^\s*UPDATE recordings/i.test(sql)
        ) {
          renewed = true;
          await realQuery(
            `UPDATE recordings SET upload_lease_expires_at = $1 WHERE id = $2`,
            [iso(60 * 60 * 1000), "renewing"],
          );
        }
        return realQuery(sql as string, args as any[] | undefined);
      },
    );

    const result = await reapExpiredUploads({ now: NOW });

    expect(renewed).toBe(true);
    expect(result.failed).toBe(0);
    expect(result.expired).toEqual([]);
    expect((await statusOf("renewing")).status).toBe("uploading");
    const { rows } = await execute(
      client,
      `SELECT key FROM application_state WHERE key = 'resumable-session-renewing'`,
    );
    expect(rows).toHaveLength(1);
    expect(await chunkKeys()).toEqual(["recording-chunks-renewing-000000"]);
  });

  it("reclaims scratch left by finalized and hard-deleted recordings", async () => {
    await insertRecording({ id: "done", status: "ready", lease: iso(30_000) });
    await insertChunk("done", 0);
    await insertChunk("gone", 0);

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

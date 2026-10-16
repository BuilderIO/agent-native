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
const mockDeleteS3ObjectByUrl = vi.hoisted(() => vi.fn());
const mockReleaseHostedClipRecording = vi.hoisted(() => vi.fn());
const mockReleaseHostedClipAllowanceAfterCleanup = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({
    execute: (statement: SqlStatement) => execute(client, statement),
  }),
}));

vi.mock("../db/index.js", async () => {
  const schema = await import("../db/schema.js");
  return { getDb: () => db, schema };
});
vi.mock("@agent-native/core/org", () => ({
  registerIdentityColumns: vi.fn(),
}));
vi.mock("./hosted-clip-allowance.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hosted-clip-allowance.js")>()),
  releaseHostedClipAllowanceAfterCleanup: (...args: unknown[]) =>
    mockReleaseHostedClipAllowanceAfterCleanup(...args),
}));

vi.mock("./resumable-upload-cleanup.js", () => ({
  abortResumableUploadSession: (...args: unknown[]) =>
    mockAbortResumableUploadSession(...args),
}));
vi.mock("./s3-upload-provider.js", () => ({
  deleteS3ObjectByUrl: (...args: unknown[]) => mockDeleteS3ObjectByUrl(...args),
}));
vi.mock("./video-storage.js", () => ({
  releaseHostedClipRecording: (...args: unknown[]) =>
    mockReleaseHostedClipRecording(...args),
}));

const {
  reapExpiredUploads,
  renewUploadLease,
  UPLOAD_LEASE_EXPIRED_REASON,
  UPLOAD_LEASE_MS,
  uploadLeaseExpiry,
  WAITING_STORAGE_EXPIRED_REASON,
  WAITING_STORAGE_LEASE_MS,
  waitingStorageLeaseExpiry,
} = await import("./upload-lease.js");

const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

async function insertRecording(row: {
  id: string;
  status: string;
  lease?: string | null;
  updatedAt?: string;
  storageMode?: "own" | "hosted" | null;
  videoUrl?: string | null;
}) {
  await execute(client, {
    sql: `INSERT INTO recordings (id, owner_email, status, upload_lease_expires_at, updated_at, storage_mode, video_url)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      "owner@example.com",
      row.status,
      row.lease ?? null,
      row.updatedAt ?? iso(-60_000),
      row.storageMode ?? null,
      row.videoUrl ?? null,
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
    mockDeleteS3ObjectByUrl.mockClear();
    mockReleaseHostedClipRecording.mockClear();
    mockReleaseHostedClipAllowanceAfterCleanup.mockClear();
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
      storage_mode TEXT,
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
    await execute(
      client,
      `CREATE TABLE clips_hosted_clip_allowances (
        recording_id TEXT PRIMARY KEY,
        identity_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        quota_bytes BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        released_at TEXT
      )`,
    );
    mockDeleteS3ObjectByUrl.mockResolvedValue(true);
    mockReleaseHostedClipRecording.mockImplementation(
      async (input: { recordingId: string }) => {
        await execute(client, {
          sql: `UPDATE clips_hosted_clip_allowances
                SET status = 'released', quota_bytes = 0, released_at = ?, updated_at = ?
                WHERE recording_id = ? AND status = 'reserved'`,
          args: [iso(0), iso(0), input.recordingId],
        });
      },
    );
    mockReleaseHostedClipAllowanceAfterCleanup.mockImplementation(
      async (input: { recordingId: string; sessionKey?: string }) => {
        await execute(client, {
          sql: `UPDATE clips_hosted_clip_allowances
                SET status = 'released', quota_bytes = 0, released_at = ?, updated_at = ?
                WHERE recording_id = ? AND status = 'reserved'`,
          args: [iso(0), iso(0), input.recordingId],
        });
        await execute(client, {
          sql: `DELETE FROM application_state WHERE key = ? OR key = ?`,
          args: [
            `hosted-cleanup-confirmed-${input.recordingId}`,
            input.sessionKey ?? "",
          ],
        });
        return true;
      },
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

  it("clears a stale parked reason once the upload is live again", async () => {
    await insertRecording({
      id: "resumed",
      status: "uploading",
      lease: iso(-1_000),
    });
    await execute(client, {
      sql: `UPDATE recordings SET failure_reason = ? WHERE id = ?`,
      args: ["Connect storage to finish saving.", "resumed"],
    });

    expect(await renewUploadLease("resumed", { now: NOW })).toEqual({
      held: true,
    });
    const reaped = await reapExpiredUploads({ now: NOW + UPLOAD_LEASE_MS + 1 });

    expect(reaped.failed).toBe(1);
    expect(await statusOf("resumed")).toMatchObject({
      failure_code: "upload_timed_out",
    });
  });

  it("preserves a parked lease during a storage-status retry and rejects stale attempts", async () => {
    await insertRecording({
      id: "preserved-parked",
      status: "uploading",
      lease: waitingStorageLeaseExpiry(NOW),
    });
    await execute(client, {
      sql: `UPDATE recordings SET failure_reason = ?, upload_attempt_id = ?, upload_generation_id = ? WHERE id = ?`,
      args: [
        "Connect storage to finish saving.",
        "attempt-current",
        "generation-current",
        "preserved-parked",
      ],
    });

    const parked = await renewUploadLease("preserved-parked", {
      now: NOW,
      attemptId: "attempt-current",
      generationId: "generation-current",
      ownerEmail: "owner@example.com",
      preserveParked: true,
    });
    expect(parked).toMatchObject({
      held: false,
      staleAttempt: false,
      status: "uploading",
      failureReason: "Connect storage to finish saving.",
    });
    const { rows: parkedRows } = await execute(client, {
      sql: `SELECT upload_lease_expires_at, failure_reason FROM recordings WHERE id = ?`,
      args: ["preserved-parked"],
    });
    expect(parkedRows[0]).toEqual({
      upload_lease_expires_at: waitingStorageLeaseExpiry(NOW),
      failure_reason: "Connect storage to finish saving.",
    });

    const stale = await renewUploadLease("preserved-parked", {
      now: NOW,
      attemptId: "attempt-stale",
      generationId: "generation-current",
      ownerEmail: "owner@example.com",
      preserveParked: true,
    });
    expect(stale).toMatchObject({
      held: false,
      staleAttempt: true,
      status: "uploading",
      failureReason: "Connect storage to finish saving.",
    });
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

  it("keeps a row parked for storage until its long lease, then fails it as setup-required and reclaims its scratch", async () => {
    await insertRecording({
      id: "parked",
      status: "uploading",
      lease: waitingStorageLeaseExpiry(NOW),
    });
    await execute(client, {
      sql: `UPDATE recordings SET failure_reason = ? WHERE id = ?`,
      args: ["Connect storage to finish saving.", "parked"],
    });
    await insertChunk("parked", 0);

    const beforeTtl = await reapExpiredUploads({ now: NOW + 6 * 86_400_000 });
    expect(beforeTtl.failed).toBe(0);
    expect((await statusOf("parked")).status).toBe("uploading");
    expect(await chunkKeys()).toEqual(["recording-chunks-parked-000000"]);

    const afterTtl = await reapExpiredUploads({
      now: NOW + WAITING_STORAGE_LEASE_MS + 1_000,
    });
    expect(afterTtl.failed).toBe(1);
    expect(await statusOf("parked")).toEqual({
      status: "failed",
      failure_reason: WAITING_STORAGE_EXPIRED_REASON,
      failure_code: "storage_setup_required",
    });
    expect(await chunkKeys()).toEqual([]);
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

  it("releases a hosted reservation after an expired upload's multipart session is confirmed aborted", async () => {
    await insertRecording({
      id: "hosted-dead",
      status: "uploading",
      lease: iso(-1_000),
      storageMode: "hosted",
    });
    await execute(client, {
      sql: `INSERT INTO clips_hosted_clip_allowances
            (recording_id, identity_key, user_id, status, quota_bytes, updated_at)
            VALUES (?, ?, ?, 'reserved', ?, ?)`,
      args: ["hosted-dead", "owner@example.com", "user-1", 250, iso(-1_000)],
    });
    await execute(client, {
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: [
        "resumable-session-hosted-dead",
        JSON.stringify({
          providerId: "clips-hosted",
          sessionId: "hosted-upload",
          meta: { objectKey: "clips/hosted-dead.webm" },
          bytesUploaded: 10,
        }),
      ],
    });

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.hostedReservationsReleased).toBe(1);
    expect(result.hostedCleanupFailed).toBe(0);
    expect(mockAbortResumableUploadSession).toHaveBeenCalledOnce();
    expect(mockReleaseHostedClipAllowanceAfterCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "hosted-dead",
        expectedUpdatedAt: iso(-1_000),
        cleanupMarkerValue: expect.any(String),
        sessionKey: "resumable-session-hosted-dead",
      }),
    );
    const { rows } = await execute(client, {
      sql: `SELECT status, quota_bytes FROM clips_hosted_clip_allowances WHERE recording_id = ?`,
      args: ["hosted-dead"],
    });
    expect(rows[0]).toEqual({ status: "released", quota_bytes: 0 });
  });

  it("retries hosted reservation release after confirmed cleanup", async () => {
    await insertRecording({
      id: "hosted-release-retry",
      status: "uploading",
      lease: iso(-1_000),
      storageMode: "hosted",
    });
    await execute(client, {
      sql: `INSERT INTO clips_hosted_clip_allowances
            (recording_id, identity_key, user_id, status, quota_bytes, updated_at)
            VALUES (?, ?, ?, 'reserved', ?, ?)`,
      args: [
        "hosted-release-retry",
        "owner@example.com",
        "user-1",
        250,
        iso(-1_000),
      ],
    });
    await execute(client, {
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: [
        "resumable-session-hosted-release-retry",
        JSON.stringify({
          providerId: "clips-hosted",
          sessionId: "hosted-upload",
          meta: { objectKey: "clips/hosted-release-retry.webm" },
          bytesUploaded: 10,
        }),
      ],
    });
    mockReleaseHostedClipAllowanceAfterCleanup.mockRejectedValueOnce(
      new Error("temporary database failure"),
    );

    const first = await reapExpiredUploads({ now: NOW });
    expect(first.hostedCleanupFailed).toBe(1);
    expect(first.hostedReservationsReleased).toBe(0);
    expect(await statusOf("hosted-release-retry")).toMatchObject({
      status: "failed",
      failure_code: "upload_timed_out",
    });
    const marker = await execute(client, {
      sql: `SELECT key FROM application_state WHERE key = ?`,
      args: ["hosted-cleanup-confirmed-hosted-release-retry"],
    });
    expect(marker.rows).toHaveLength(1);

    const second = await reapExpiredUploads({ now: NOW + 1_000 });

    expect(second.hostedCleanupFailed).toBe(0);
    expect(second.hostedReservationsReleased).toBe(1);
    const { rows } = await execute(client, {
      sql: `SELECT status, quota_bytes FROM clips_hosted_clip_allowances WHERE recording_id = ?`,
      args: ["hosted-release-retry"],
    });
    expect(rows[0]).toEqual({ status: "released", quota_bytes: 0 });
    const markers = await execute(client, {
      sql: `SELECT key FROM application_state WHERE key = ?`,
      args: ["hosted-cleanup-confirmed-hosted-release-retry"],
    });
    expect(markers.rows).toHaveLength(0);
  });

  it("clears a confirmed-deleted URL before releasing its hosted reservation", async () => {
    const videoUrl = "https://clips.example.test/hosted-crash.mp4";
    await insertRecording({
      id: "hosted-delete-marker-crash",
      status: "failed",
      storageMode: "hosted",
      videoUrl,
    });
    await execute(client, {
      sql: `INSERT INTO clips_hosted_clip_allowances
            (recording_id, identity_key, user_id, status, quota_bytes, updated_at)
            VALUES (?, ?, ?, 'reserved', ?, ?)`,
      args: [
        "hosted-delete-marker-crash",
        "owner@example.com",
        "user-1",
        250,
        iso(-1_000),
      ],
    });
    const markerValue = JSON.stringify({ videoUrl, cleanupId: "confirmed" });
    await execute(client, {
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: [
        "hosted-cleanup-confirmed-hosted-delete-marker-crash",
        markerValue,
      ],
    });

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.hostedReservationsReleased).toBe(1);
    expect(result.hostedCleanupFailed).toBe(0);
    expect(mockDeleteS3ObjectByUrl).not.toHaveBeenCalled();
    expect(mockReleaseHostedClipAllowanceAfterCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "hosted-delete-marker-crash",
        cleanupMarkerValue: markerValue,
      }),
    );
    const { rows } = await execute(client, {
      sql: `SELECT video_url, video_size_bytes FROM recordings WHERE id = ?`,
      args: ["hosted-delete-marker-crash"],
    });
    expect(rows[0]).toEqual({ video_url: null, video_size_bytes: 0 });
  });

  it("finishes an aborted hosted upload whose session abort failed, once the provider confirms it", async () => {
    await insertRecording({
      id: "hosted-aborted",
      status: "failed",
      storageMode: "hosted",
    });
    await execute(client, {
      sql: `INSERT INTO clips_hosted_clip_allowances
            (recording_id, identity_key, user_id, status, quota_bytes, updated_at)
            VALUES (?, ?, ?, 'reserved', ?, ?)`,
      args: ["hosted-aborted", "owner@example.com", "user-1", 250, iso(-1_000)],
    });
    await execute(client, {
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: [
        "resumable-session-hosted-aborted",
        JSON.stringify({
          providerId: "clips-hosted",
          sessionId: "hosted-upload",
          meta: { objectKey: "clips/hosted-aborted.webm" },
          bytesUploaded: 10,
        }),
      ],
    });
    await execute(client, {
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: [
        "recording-upload-hosted-aborted",
        JSON.stringify({ status: "failed", aborted: true }),
      ],
    });

    mockAbortResumableUploadSession.mockClear();
    mockAbortResumableUploadSession.mockResolvedValueOnce(false);
    const first = await reapExpiredUploads({ now: NOW });
    expect(first.hostedReservationsReleased).toBe(0);
    expect(first.hostedCleanupFailed).toBe(1);
    expect(mockAbortResumableUploadSession).toHaveBeenCalledTimes(1);

    const second = await reapExpiredUploads({ now: NOW + 1_000 });
    expect(second.hostedReservationsReleased).toBe(1);
    expect(mockAbortResumableUploadSession).toHaveBeenCalledTimes(2);
  });

  it("recovers an expired hosted upload when failure was saved before its cleanup marker", async () => {
    await insertRecording({
      id: "hosted-marker-crash",
      status: "failed",
      storageMode: "hosted",
    });
    await execute(client, {
      sql: `INSERT INTO clips_hosted_clip_allowances
            (recording_id, identity_key, user_id, status, quota_bytes, updated_at)
            VALUES (?, ?, ?, 'reserved', ?, ?)`,
      args: [
        "hosted-marker-crash",
        "owner@example.com",
        "user-1",
        250,
        iso(-1_000),
      ],
    });
    await execute(client, {
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: [
        "recording-upload-hosted-marker-crash",
        JSON.stringify({ status: "uploading" }),
      ],
    });

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.hostedReservationsReleased).toBe(1);
    expect(result.hostedCleanupFailed).toBe(0);
    expect(mockReleaseHostedClipAllowanceAfterCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "hosted-marker-crash",
        cleanupMarkerValue: expect.any(String),
      }),
    );
  });

  it("keeps a hosted reservation when multipart cleanup cannot be confirmed", async () => {
    mockAbortResumableUploadSession.mockResolvedValue(false);
    await insertRecording({
      id: "hosted-unclean",
      status: "uploading",
      lease: iso(-1_000),
      storageMode: "hosted",
    });
    await execute(client, {
      sql: `INSERT INTO clips_hosted_clip_allowances
            (recording_id, identity_key, user_id, status, quota_bytes, updated_at)
            VALUES (?, ?, ?, 'reserved', ?, ?)`,
      args: ["hosted-unclean", "owner@example.com", "user-1", 250, iso(-1_000)],
    });
    await execute(client, {
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: [
        "resumable-session-hosted-unclean",
        JSON.stringify({
          providerId: "clips-hosted",
          sessionId: "hosted-upload",
          meta: { objectKey: "clips/hosted-unclean.webm" },
          bytesUploaded: 10,
        }),
      ],
    });

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.hostedReservationsReleased).toBe(0);
    expect(result.hostedCleanupFailed).toBe(1);
    expect(mockReleaseHostedClipAllowanceAfterCleanup).not.toHaveBeenCalled();
    const { rows } = await execute(client, {
      sql: `SELECT status, quota_bytes FROM clips_hosted_clip_allowances WHERE recording_id = ?`,
      args: ["hosted-unclean"],
    });
    expect(rows[0]).toEqual({ status: "reserved", quota_bytes: 250 });
  });

  it("keeps a hosted processing reservation when completion has no persisted URL to clean", async () => {
    await insertRecording({
      id: "hosted-ambiguous",
      status: "processing",
      lease: iso(-1_000),
      storageMode: "hosted",
    });
    await execute(client, {
      sql: `INSERT INTO clips_hosted_clip_allowances
            (recording_id, identity_key, user_id, status, quota_bytes, updated_at)
            VALUES (?, ?, ?, 'reserved', ?, ?)`,
      args: [
        "hosted-ambiguous",
        "owner@example.com",
        "user-1",
        250,
        iso(-1_000),
      ],
    });
    await execute(client, {
      sql: `INSERT INTO application_state (key, value) VALUES (?, ?)`,
      args: [
        "resumable-session-hosted-ambiguous",
        JSON.stringify({
          providerId: "clips-hosted",
          sessionId: "hosted-upload",
          meta: { objectKey: "clips/hosted-ambiguous.webm" },
          bytesUploaded: 10,
        }),
      ],
    });

    const result = await reapExpiredUploads({ now: NOW });

    expect(result.hostedReservationsReleased).toBe(0);
    expect(result.hostedCleanupFailed).toBe(1);
    expect(mockReleaseHostedClipAllowanceAfterCleanup).not.toHaveBeenCalled();
    const { rows } = await execute(client, {
      sql: `SELECT status FROM clips_hosted_clip_allowances WHERE recording_id = ?`,
      args: ["hosted-ambiguous"],
    });
    expect(rows[0]?.status).toBe("reserved");
    const session = await execute(client, {
      sql: `SELECT key FROM application_state WHERE key = ?`,
      args: ["resumable-session-hosted-ambiguous"],
    });
    expect(session.rows).toHaveLength(1);
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

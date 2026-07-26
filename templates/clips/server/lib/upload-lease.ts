/**
 * The upload lease.
 *
 * One authoritative expiry, `recordings.upload_lease_expires_at`, renewed by
 * the client's own chunk POSTs. Liveness is a fact the writer asserts, not
 * something a GC infers by joining `recordings` against `application_state`
 * and comparing timestamps stored in two different encodings.
 *
 * Everything below reads from `recordings`, so the reaper sees every
 * in-progress upload — including buffered uploads that never opened a
 * resumable session, which the old session-keyed sweep could not select.
 */

import { getDbExec, isPostgres } from "@agent-native/core/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

/**
 * ponytail: one horizon for both in-progress statuses. A paused recorder emits
 * no chunks and finalize/verification can run for a while, so a shorter lease
 * would reap live uploads; a longer one leaves a dead upload spinning. Shorten
 * it only once every client sends an explicit heartbeat.
 */
export const UPLOAD_LEASE_MS = 60 * 60 * 1000;

export const UPLOAD_LEASE_EXPIRED_REASON =
  "Upload stopped sending data before the recording finished saving.";

const IN_PROGRESS_STATUSES = ["uploading", "processing"] as const;

export function uploadLeaseExpiry(nowMs: number = Date.now()): string {
  return new Date(nowMs + UPLOAD_LEASE_MS).toISOString();
}

export type UploadLeaseResult =
  | { held: true }
  | {
      held: false;
      status: string | null;
      failureReason: string | null;
      videoUrl: string | null;
      videoSizeBytes: number | null;
      durationMs: number | null;
    };

/**
 * Take or renew the lease for one recording.
 *
 * This is a compare-and-set: `WHERE status IN (...)` is what makes racing a
 * concurrent abort or finalize structurally impossible. A terminal row updates
 * zero rows, so a caller never needs to re-check after each write.
 */
export async function renewUploadLease(
  recordingId: string,
  options: { now?: number; uploadProgress?: number } = {},
): Promise<UploadLeaseResult> {
  const now = options.now ?? Date.now();
  const held = await getDb()
    .update(schema.recordings)
    .set({
      uploadLeaseExpiresAt: uploadLeaseExpiry(now),
      updatedAt: new Date(now).toISOString(),
      // Chunks can land out of order, so progress only ever moves forward.
      ...(options.uploadProgress === undefined
        ? {}
        : {
            uploadProgress: sql`CASE WHEN ${schema.recordings.uploadProgress} > ${options.uploadProgress} THEN ${schema.recordings.uploadProgress} ELSE ${options.uploadProgress} END`,
          }),
    })
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        inArray(schema.recordings.status, [...IN_PROGRESS_STATUSES]),
      ),
    )
    .returning({ id: schema.recordings.id });

  if (held.length > 0) return { held: true };

  const [row] = await getDb()
    .select({
      status: schema.recordings.status,
      failureReason: schema.recordings.failureReason,
      videoUrl: schema.recordings.videoUrl,
      videoSizeBytes: schema.recordings.videoSizeBytes,
      durationMs: schema.recordings.durationMs,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId));

  return {
    held: false,
    status: row?.status ?? null,
    failureReason: row?.failureReason ?? null,
    videoUrl: row?.videoUrl ?? null,
    videoSizeBytes: row?.videoSizeBytes ?? null,
    durationMs: row?.durationMs ?? null,
  };
}

export interface ReapedUpload {
  id: string;
  ownerEmail: string;
  status: string;
  leaseExpiresAt: string;
}

export interface ReapResult {
  dryRun: boolean;
  expired: ReapedUpload[];
  failed: number;
  scratchKeysDeleted: number;
}

/**
 * Terminate uploads whose lease expired, then reclaim chunk scratch that no
 * live upload claims.
 *
 * The only liveness input is the lease the writer last wrote, and the only
 * thing protecting scratch is the existence of an in-progress `recordings`
 * row. There is no "the recording row was not visible to this probe" branch:
 * in-progress rows are selected from `recordings` itself, and the scratch
 * anti-join runs inside the database rather than across two round trips.
 */
export async function reapExpiredUploads(
  options: { now?: number; limit?: number; dryRun?: boolean } = {},
): Promise<ReapResult> {
  const exec = getDbExec();
  const pg = isPostgres();
  const nowIso = new Date(options.now ?? Date.now()).toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const dryRun = options.dryRun === true;
  const p = (i: number) => (pg ? `$${i}` : "?");

  // guard:allow-unscoped — system upload reaper, owner-agnostic by design.
  const probe = await exec.execute({
    sql: `SELECT id, owner_email, status, upload_lease_expires_at
          FROM recordings
          WHERE status IN ('uploading', 'processing')
            AND upload_lease_expires_at IS NOT NULL
            AND upload_lease_expires_at < ${p(1)}
          ORDER BY upload_lease_expires_at ASC
          LIMIT ${limit}`,
    args: [nowIso],
  });

  const expired: ReapedUpload[] = (
    (probe.rows as Array<Record<string, unknown>>) ?? []
  ).map((row) => ({
    id: String(row.id),
    ownerEmail: String(row.owner_email ?? ""),
    status: String(row.status ?? ""),
    leaseExpiresAt: String(row.upload_lease_expires_at ?? ""),
  }));

  let failed = 0;
  if (expired.length > 0 && !dryRun) {
    const ids = expired.map((row) => row.id);
    const result = await exec.execute({
      sql: `UPDATE recordings
            SET status = 'failed',
                failure_reason = ${p(1)},
                updated_at = ${p(2)}
            WHERE id IN (${ids.map((_, i) => p(i + 4)).join(", ")})
              AND status IN ('uploading', 'processing')
              AND upload_lease_expires_at < ${p(3)}`,
      args: [UPLOAD_LEASE_EXPIRED_REASON, nowIso, nowIso, ...ids],
    });
    failed = result.rowsAffected ?? 0;

    for (const id of ids) {
      await exec.execute({
        sql: `DELETE FROM application_state WHERE key = ${p(1)}`,
        args: [`resumable-session-${id}`],
      });
    }
  }

  const scratchKeysDeleted = dryRun
    ? (await selectUnclaimedChunkKeys(limit)).length
    : await deleteUnclaimedChunkScratch(limit);

  return { dryRun, expired, failed, scratchKeysDeleted };
}

/**
 * Chunk scratch is claimed by exactly one thing: an in-progress `recordings`
 * row. Anything else — finalized, failed, or hard-deleted recordings — is
 * reclaimable, with no age grace needed, because a stuck upload can only leave
 * the in-progress set through the reaper above.
 */
async function selectUnclaimedChunkKeys(limit: number): Promise<string[]> {
  // guard:allow-unscoped — system scratch GC, owner-agnostic by design.
  const { rows } = await getDbExec().execute({
    sql: `SELECT a.key AS key
          FROM application_state a
          WHERE a.key LIKE 'recording-chunks-%'
            AND NOT EXISTS (
              SELECT 1 FROM recordings r
              WHERE r.status IN ('uploading', 'processing')
                AND a.key LIKE 'recording-chunks-' || r.id || '-%'
            )
          LIMIT ${limit}`,
    args: [],
  });
  return ((rows as Array<{ key?: unknown }>) ?? []).map((row) =>
    String(row.key),
  );
}

async function deleteUnclaimedChunkScratch(limit: number): Promise<number> {
  const keys = await selectUnclaimedChunkKeys(limit);
  if (keys.length === 0) return 0;
  const pg = isPostgres();
  const placeholders = keys.map((_, i) => (pg ? `$${i + 1}` : "?")).join(", ");
  const result = await getDbExec().execute({
    sql: `DELETE FROM application_state WHERE key IN (${placeholders})`,
    args: keys,
  });
  return result.rowsAffected ?? keys.length;
}

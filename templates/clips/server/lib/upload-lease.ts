/**
 * The upload lease.
 *
 * One authoritative expiry, `recordings.upload_lease_expires_at`, renewed by
 * the client's own chunk POSTs. Liveness is a fact the writer asserts, not
 * something a GC infers by joining `recordings` against `application_state`
 * and comparing timestamps stored in two encodings.
 *
 * Everything reads from `recordings`, so the reaper sees every in-progress
 * upload — including buffered uploads that never opened a resumable session,
 * which the old session-keyed sweep could not select at all.
 */

import { getDbExec, isPostgres } from "@agent-native/core/db";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

/**
 * ponytail: one horizon for both in-progress statuses. A paused recorder emits
 * no chunks and finalize/verification can run for a while, so a shorter lease
 * would reap live uploads; a longer one leaves a dead upload spinning. Shorten
 * this only once clients send an explicit heartbeat.
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
 * Take/renew the lease for one recording. This is a compare-and-set: the
 * `WHERE status IN (...)` clause is what makes a concurrent abort or finalize
 * structurally impossible to race — a terminal row updates zero rows, so
 * callers never need a re-check after each write.
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
      ...(options.uploadProgress === undefined
        ? {}
        : { uploadProgress: options.uploadProgress }),
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

/** Release the lease without changing status. Used when a retry resets state. */
export async function clearUploadLease(recordingId: string): Promise<void> {
  await getDb()
    .update(schema.recordings)
    .set({ uploadLeaseExpiresAt: null })
    .where(eq(schema.recordings.id, recordingId));
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
  scratchRowsDeleted: number;
}

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (match) => `!${match}`);
}

/**
 * Terminate uploads whose lease expired and reclaim their scratch space.
 *
 * The only liveness input is the lease the writer last wrote. There is no
 * "the recording row was not visible to this probe" branch: an in-progress row
 * is selected from `recordings` itself, so it always exists.
 */
export async function reapExpiredUploads(
  options: { now?: number; limit?: number; dryRun?: boolean } = {},
): Promise<ReapResult> {
  const exec = getDbExec();
  const pg = isPostgres();
  const nowIso = new Date(options.now ?? Date.now()).toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const dryRun = options.dryRun === true;

  // guard:allow-unscoped — system upload reaper, owner-agnostic by design.
  const probe = await exec.execute({
    sql: `SELECT id, owner_email, status, upload_lease_expires_at
          FROM recordings
          WHERE status IN ('uploading', 'processing')
            AND upload_lease_expires_at IS NOT NULL
            AND upload_lease_expires_at < ${pg ? "$1" : "?"}
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

  if (expired.length === 0 || dryRun) {
    return { dryRun, expired, failed: 0, scratchRowsDeleted: 0 };
  }

  const ids = expired.map((row) => row.id);
  const idPlaceholders = ids.map((_, i) => (pg ? `$${i + 4}` : "?")).join(", ");
  const failedResult = await exec.execute({
    sql: `UPDATE recordings
          SET status = 'failed',
              failure_reason = ${pg ? "$1" : "?"},
              updated_at = ${pg ? "$2" : "?"},
              upload_lease_expires_at = NULL
          WHERE id IN (${idPlaceholders})
            AND status IN ('uploading', 'processing')
            AND upload_lease_expires_at < ${pg ? "$3" : "?"}`,
    args: pg
      ? [UPLOAD_LEASE_EXPIRED_REASON, nowIso, nowIso, ...ids]
      : [UPLOAD_LEASE_EXPIRED_REASON, nowIso, nowIso, ...ids],
  });

  let scratchRowsDeleted = 0;
  for (const id of ids) {
    const result = await exec.execute({
      sql: `DELETE FROM application_state
            WHERE key = ${pg ? "$1" : "?"}
               OR key = ${pg ? "$2" : "?"}
               OR key LIKE ${pg ? "$3" : "?"} ESCAPE '!'`,
      args: [
        `resumable-session-${id}`,
        `recording-upload-${id}`,
        `${escapeLike(`recording-chunks-${id}-`)}%`,
      ],
    });
    scratchRowsDeleted += result.rowsAffected ?? 0;
  }

  return {
    dryRun,
    expired,
    failed: failedResult.rowsAffected ?? 0,
    scratchRowsDeleted,
  };
}

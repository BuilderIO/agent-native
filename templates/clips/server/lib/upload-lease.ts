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
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type { StoredResumableSession } from "./resumable-session.js";
import { abortResumableUploadSession } from "./resumable-upload-cleanup.js";

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
      staleAttempt: boolean;
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
  options: {
    now?: number;
    uploadProgress?: number;
    attemptId?: string | null;
    generationId?: string | null;
  } = {},
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
        ...(options.attemptId === undefined
          ? []
          : [
              options.attemptId === null
                ? isNull(schema.recordings.uploadAttemptId)
                : eq(schema.recordings.uploadAttemptId, options.attemptId),
            ]),
        ...(options.generationId === undefined
          ? []
          : [
              options.generationId === null
                ? isNull(schema.recordings.uploadGenerationId)
                : eq(
                    schema.recordings.uploadGenerationId,
                    options.generationId,
                  ),
            ]),
      ),
    )
    .returning({ id: schema.recordings.id });

  if (held.length > 0) return { held: true };

  // guard:allow-unscoped — by primary key, and every caller resolves the
  // recording through an owner-scoped read before asking for the lease.
  const [row] = await getDb()
    .select({
      status: schema.recordings.status,
      failureReason: schema.recordings.failureReason,
      videoUrl: schema.recordings.videoUrl,
      videoSizeBytes: schema.recordings.videoSizeBytes,
      durationMs: schema.recordings.durationMs,
      uploadAttemptId: schema.recordings.uploadAttemptId,
      uploadGenerationId: schema.recordings.uploadGenerationId,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId));

  return {
    held: false,
    staleAttempt:
      (options.attemptId !== undefined || options.generationId !== undefined) &&
      IN_PROGRESS_STATUSES.includes(
        row?.status as (typeof IN_PROGRESS_STATUSES)[number],
      ) &&
      ((options.attemptId !== undefined &&
        row?.uploadAttemptId !== options.attemptId) ||
        (options.generationId !== undefined &&
          row?.uploadGenerationId !== options.generationId)),
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
  uploadGenerationId: string | null;
}

export interface ReapResult {
  dryRun: boolean;
  expired: ReapedUpload[];
  failed: number;
  scratchKeysDeleted: number;
  resumableSessionsAborted: number;
  resumableCleanupFailed: number;
}

function resumableSessionKey(
  recordingId: string,
  generationId: string | null,
): string {
  return generationId
    ? `resumable-session-${recordingId}-${generationId}`
    : `resumable-session-${recordingId}`;
}

function parseStoredResumableSession(
  value: unknown,
): StoredResumableSession | null {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.providerId !== "string" ||
    typeof candidate.sessionId !== "string" ||
    !candidate.meta ||
    typeof candidate.meta !== "object" ||
    typeof candidate.bytesUploaded !== "number" ||
    !Number.isFinite(candidate.bytesUploaded) ||
    candidate.bytesUploaded < 0
  ) {
    return null;
  }
  return candidate as unknown as StoredResumableSession;
}

async function readResumableSessionState(
  exec: ReturnType<typeof getDbExec>,
  placeholder: string,
  key: string,
): Promise<{ present: boolean; session: StoredResumableSession | null }> {
  const result = await exec.execute({
    sql: `SELECT value FROM application_state WHERE key = ${placeholder}`,
    args: [key],
  });
  const row = (result.rows as Array<{ value?: unknown }> | undefined)?.[0];
  return {
    present: row !== undefined,
    session: row === undefined ? null : parseStoredResumableSession(row.value),
  };
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
    sql: `SELECT id, owner_email, status, upload_lease_expires_at, upload_generation_id
          FROM recordings
          WHERE status IN ('uploading', 'processing')
            AND upload_lease_expires_at IS NOT NULL
            AND upload_lease_expires_at < ${p(1)}
          ORDER BY upload_lease_expires_at ASC
          LIMIT ${limit}`,
    args: [nowIso],
  });

  let expired: ReapedUpload[] = (
    (probe.rows as Array<Record<string, unknown>>) ?? []
  ).map((row) => ({
    id: String(row.id),
    ownerEmail: String(row.owner_email ?? ""),
    status: String(row.status ?? ""),
    leaseExpiresAt: String(row.upload_lease_expires_at ?? ""),
    uploadGenerationId:
      typeof row.upload_generation_id === "string"
        ? row.upload_generation_id
        : null,
  }));

  let failed = 0;
  let resumableSessionsAborted = 0;
  let resumableCleanupFailed = 0;
  if (expired.length > 0 && !dryRun) {
    const ids = expired.map((row) => row.id);
    const result = await exec.execute({
      sql: `UPDATE recordings
            SET status = 'failed',
                failure_reason = ${p(1)},
                updated_at = ${p(2)}
            WHERE status IN ('uploading', 'processing')
              AND upload_lease_expires_at < ${p(3)}
              AND id IN (${ids.map((_, i) => p(i + 4)).join(", ")})
            RETURNING id`,
      args: [UPLOAD_LEASE_EXPIRED_REASON, nowIso, nowIso, ...ids],
    });

    // The probe is a snapshot. A lease renewed between it and this
    // compare-and-set keeps its row, so only what the UPDATE actually claimed
    // may be reported or have its session state swept — reading the probe
    // list here would tear down a live streaming upload's session.
    const terminated = new Set(
      ((result.rows as Array<{ id?: unknown }>) ?? []).map((row) =>
        String(row.id),
      ),
    );
    expired = expired.filter((row) => terminated.has(row.id));
    failed = terminated.size;

    for (const id of terminated) {
      const generationId =
        expired.find((row) => row.id === id)?.uploadGenerationId ?? null;
      const sessionKey = resumableSessionKey(id, generationId);
      const sessionState = await readResumableSessionState(
        exec,
        p(1),
        sessionKey,
      );
      if (sessionState.present && !sessionState.session) {
        resumableCleanupFailed += 1;
        console.warn(
          `[upload-reaper-${id}] resumable session state is unreadable; keeping it for manual cleanup`,
        );
        continue;
      }
      if (sessionState.session) {
        const cleaned = await abortResumableUploadSession(
          sessionState.session,
          { label: `upload-reaper-${id}` },
        );
        if (!cleaned) {
          resumableCleanupFailed += 1;
          continue;
        }
        resumableSessionsAborted += 1;
      }
      await exec.execute({
        sql: `DELETE FROM application_state WHERE key = ${p(1)}`,
        args: [sessionKey],
      });
    }
  }

  const scratchKeysDeleted = dryRun
    ? (await selectUnclaimedChunkKeys(limit)).length
    : await deleteUnclaimedChunkScratch(limit);

  return {
    dryRun,
    expired,
    failed,
    scratchKeysDeleted,
    resumableSessionsAborted,
    resumableCleanupFailed,
  };
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
  if (typeof result.rowsAffected !== "number") {
    throw new Error(
      "Upload scratch cleanup did not report rowsAffected; refusing to claim deletion succeeded",
    );
  }
  return result.rowsAffected;
}

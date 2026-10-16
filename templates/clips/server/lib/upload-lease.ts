import { getDbExec } from "@agent-native/core/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { WAITING_STORAGE_EXPIRED_REASON } from "../../shared/upload-interruption.js";
import { getDb, schema } from "../db/index.js";
import {
  releaseHostedClipAllowanceAfterCleanup,
  writeHostedCleanupConfirmedMarker,
} from "./hosted-clip-allowance.js";
import {
  normalizeRecordingPlatform,
  trackRecordingFailure,
} from "./recording-failures.js";
import { ownerEmailMatches } from "./recordings.js";
import type { StoredResumableSession } from "./resumable-session.js";
import { abortResumableUploadSession } from "./resumable-upload-cleanup.js";
import { deleteS3ObjectByUrl } from "./s3-upload-provider.js";

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

/**
 * A row parked until storage is connected (dev scratch chunks, a Loom or
 * video-link import) is not a live upload: it waits this long for setup, then
 * the reaper fails it as `storage_setup_required` and its scratch is
 * collected. Resuming it claims a normal lease.
 */
export const WAITING_STORAGE_LEASE_MS = 7 * 24 * 60 * 60 * 1000;

export { WAITING_STORAGE_EXPIRED_REASON };

export function waitingStorageLeaseExpiry(nowMs: number = Date.now()): string {
  return new Date(nowMs + WAITING_STORAGE_LEASE_MS).toISOString();
}

/** Parked rows are the only `uploading` rows that carry a failure reason. */
export function isParkedForStorage(row: {
  status: string | null;
  failureReason?: string | null;
}): boolean {
  return row.status === "uploading" && Boolean(row.failureReason);
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

export async function renewUploadLease(
  recordingId: string,
  options: {
    now?: number;
    uploadProgress?: number;
    attemptId?: string | null;
    generationId?: string | null;
    ownerEmail?: string;
    loomImportClaimId?: string;
    preserveParked?: boolean;
  } = {},
): Promise<UploadLeaseResult> {
  const now = options.now ?? Date.now();
  const claimScoped = options.loomImportClaimId !== undefined;
  const held = await getDb()
    .update(schema.recordings)
    .set({
      uploadLeaseExpiresAt: uploadLeaseExpiry(now),
      // A live upload is not parked: a reason left from an earlier pause
      // would make the reaper call a later lapse storage_setup_required.
      failureReason: sql`CASE WHEN ${schema.recordings.status} = 'uploading' THEN NULL ELSE ${schema.recordings.failureReason} END`,
      updatedAt: new Date(now).toISOString(),
      ...(claimScoped
        ? { loomImportClaimedAt: new Date(now).toISOString() }
        : {}),
      ...(options.uploadProgress === undefined
        ? {}
        : {
            uploadProgress: sql`CASE WHEN ${schema.recordings.uploadProgress} > ${options.uploadProgress} THEN ${schema.recordings.uploadProgress} ELSE ${options.uploadProgress} END`,
          }),
    })
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        claimScoped
          ? eq(schema.recordings.status, "processing")
          : inArray(schema.recordings.status, [...IN_PROGRESS_STATUSES]),
        ...(options.preserveParked
          ? [
              sql`NOT (${schema.recordings.status} = 'uploading' AND ${schema.recordings.failureReason} IS NOT NULL AND ${schema.recordings.failureReason} <> '')`,
            ]
          : []),
        ...(options.ownerEmail === undefined
          ? []
          : [
              ownerEmailMatches(
                schema.recordings.ownerEmail,
                options.ownerEmail,
              ),
            ]),
        ...(options.loomImportClaimId === undefined
          ? []
          : [
              eq(
                schema.recordings.loomImportClaimId,
                options.loomImportClaimId,
              ),
            ]),
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
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ...(options.ownerEmail === undefined
          ? []
          : [
              ownerEmailMatches(
                schema.recordings.ownerEmail,
                options.ownerEmail,
              ),
            ]),
      ),
    );

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
  storageMode: "own" | "hosted" | null;
  videoUrl: string | null;
}

export interface ReapResult {
  dryRun: boolean;
  expired: ReapedUpload[];
  failed: number;
  scratchKeysDeleted: number;
  resumableSessionsAborted: number;
  resumableCleanupFailed: number;
  hostedReservationsReleased: number;
  hostedCleanupFailed: number;
}

export async function markHostedCleanupConfirmed(
  recordingId: string,
  videoUrl: string | null = null,
): Promise<string> {
  return writeHostedCleanupConfirmedMarker({ recordingId, videoUrl });
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
      // coercion-ok: malformed persisted session is absent, not an active session.
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

async function readUploadStateStatus(
  exec: ReturnType<typeof getDbExec>,
  recordingId: string,
): Promise<string | null> {
  const result = await exec.execute({
    sql: `SELECT value FROM application_state WHERE key = $1`,
    args: [`recording-upload-${recordingId}`],
  });
  const value = (result.rows as Array<{ value?: unknown }> | undefined)?.[0]
    ?.value;
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // coercion-ok: malformed state returns null so the caller keeps the reservation.
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const state = parsed as Record<string, unknown>;
  // An explicit abort wrote this state itself; it is not a processing upload
  // that may have finished remotely.
  if (state.aborted === true) return "aborted";
  return typeof state.status === "string" ? state.status : null;
}

export async function reapExpiredUploads(
  options: { now?: number; limit?: number; dryRun?: boolean } = {},
): Promise<ReapResult> {
  const exec = getDbExec();
  const nowIso = new Date(options.now ?? Date.now()).toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const dryRun = options.dryRun === true;

  const pendingHostedReleases = await exec.execute({
    sql: `SELECT r.id, r.owner_email, r.video_url, r.upload_generation_id,
                 a.updated_at AS allowance_updated_at,
                 s.key AS cleanup_confirmed_key,
                 s.value AS cleanup_confirmed_value
          FROM recordings r
          JOIN clips_hosted_clip_allowances a ON a.recording_id = r.id
          LEFT JOIN application_state s ON s.key = $1 || r.id
          WHERE r.storage_mode = 'hosted'
            AND r.status = 'failed'
            AND a.status = 'reserved'
            AND (
              s.key IS NOT NULL
              OR r.video_url IS NOT NULL
              OR EXISTS (
                SELECT 1 FROM application_state session_state
                WHERE session_state.key = CASE
                  WHEN r.upload_generation_id IS NULL
                  THEN 'resumable-session-' || r.id
                  ELSE 'resumable-session-' || r.id || '-' || r.upload_generation_id
                END
              )
              OR EXISTS (
                SELECT 1 FROM application_state upload_state
                WHERE upload_state.key = 'recording-upload-' || r.id
              )
            )
          ORDER BY r.updated_at ASC
          LIMIT ${limit}`,
    args: ["hosted-cleanup-confirmed-"],
  });

  // guard:allow-unscoped — system upload reaper, owner-agnostic by design.
  const probe = await exec.execute({
    sql: `SELECT id, owner_email, status, upload_lease_expires_at, upload_generation_id,
                 storage_mode, video_url
          FROM recordings
          WHERE status IN ('uploading', 'processing')
            AND upload_lease_expires_at IS NOT NULL
            AND upload_lease_expires_at < $1
          ORDER BY upload_lease_expires_at ASC
          LIMIT ${limit}`,
    args: [nowIso],
  });

  let expired: ReapedUpload[] = (
    (probe.rows as Array<Record<string, unknown>>) ?? []
  ).map((row) => ({
    id: String(row.id),
    ownerEmail: typeof row.owner_email === "string" ? row.owner_email : "",
    status: typeof row.status === "string" ? row.status : "",
    leaseExpiresAt:
      typeof row.upload_lease_expires_at === "string"
        ? row.upload_lease_expires_at
        : "",
    uploadGenerationId:
      typeof row.upload_generation_id === "string"
        ? row.upload_generation_id
        : null,
    storageMode:
      row.storage_mode === "hosted" || row.storage_mode === "own"
        ? row.storage_mode
        : null,
    videoUrl: typeof row.video_url === "string" ? row.video_url : null,
  }));

  let failed = 0;
  let resumableSessionsAborted = 0;
  let resumableCleanupFailed = 0;
  let hostedReservationsReleased = 0;
  let hostedCleanupFailed = 0;
  if (!dryRun) {
    for (const row of (pendingHostedReleases.rows as Array<
      Record<string, unknown>
    >) ?? []) {
      const id = String(row.id);
      const generationId =
        typeof row.upload_generation_id === "string"
          ? row.upload_generation_id
          : null;
      const sessionKey = resumableSessionKey(id, generationId);
      const ownerEmail =
        typeof row.owner_email === "string" ? row.owner_email : null;
      const cleanupConfirmed = typeof row.cleanup_confirmed_key === "string";
      const videoUrl = typeof row.video_url === "string" ? row.video_url : null;
      const expectedUpdatedAt =
        typeof row.allowance_updated_at === "string"
          ? row.allowance_updated_at
          : null;
      let confirmedVideoUrl: string | null = null;
      let markerValue =
        typeof row.cleanup_confirmed_value === "string"
          ? row.cleanup_confirmed_value
          : null;
      if (typeof row.cleanup_confirmed_value === "string") {
        try {
          const marker = JSON.parse(row.cleanup_confirmed_value) as {
            videoUrl?: unknown;
          };
          confirmedVideoUrl =
            typeof marker.videoUrl === "string" ? marker.videoUrl : null;
        } catch {
          // coercion-ok: marker key confirms cleanup when no video URL remains.
          // Older markers establish cleanup only when no media URL remains.
        }
      }
      const cleanupNeeded =
        !cleanupConfirmed ||
        (videoUrl !== null && confirmedVideoUrl !== videoUrl);
      if (cleanupNeeded) {
        const sessionState = await readResumableSessionState(
          exec,
          "$1",
          sessionKey,
        );
        if (sessionState.present && !sessionState.session) {
          hostedCleanupFailed += 1;
          continue;
        }
        const uploadStatus = !videoUrl
          ? await readUploadStateStatus(exec, id)
          : null;
        if (
          !videoUrl &&
          uploadStatus !== "uploading" &&
          uploadStatus !== "aborted"
        ) {
          // A processing upload without a persisted URL may already have
          // completed remotely, so aborting its old multipart handle is not
          // enough evidence to release the reservation.
          hostedCleanupFailed += 1;
          continue;
        }
        if (sessionState.session) {
          const cleaned = await abortResumableUploadSession(
            sessionState.session,
            { label: `upload-reaper-${id}` },
          );
          if (!cleaned) {
            hostedCleanupFailed += 1;
            continue;
          }
          resumableSessionsAborted += 1;
        }
        if (videoUrl) {
          let deleted = cleanupConfirmed && confirmedVideoUrl === videoUrl;
          if (!deleted) {
            try {
              deleted = await deleteS3ObjectByUrl(videoUrl, {
                storageMode: "hosted",
                recordingId: id,
              });
            } catch (error) {
              console.warn(
                `[upload-reaper-${id}] hosted media cleanup failed`,
                {
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            }
            if (!deleted) {
              hostedCleanupFailed += 1;
              continue;
            }
            markerValue = await markHostedCleanupConfirmed(id, videoUrl);
          }
          const cleared = await exec.execute({
            sql: `UPDATE recordings
                  SET video_url = NULL, video_size_bytes = 0, updated_at = $1
                  WHERE id = $2 AND status = 'failed' AND video_url = $3
                  RETURNING id`,
            args: [nowIso, id, videoUrl],
          });
          if (!(cleared.rows as Array<unknown> | undefined)?.length) {
            hostedCleanupFailed += 1;
            continue;
          }
        }
        if (!videoUrl && !markerValue) {
          markerValue = await markHostedCleanupConfirmed(id);
        }
      } else if (videoUrl) {
        const cleared = await exec.execute({
          sql: `UPDATE recordings
                SET video_url = NULL, video_size_bytes = 0, updated_at = $1
                WHERE id = $2 AND status = 'failed' AND video_url = $3
                RETURNING id`,
          args: [nowIso, id, videoUrl],
        });
        if (!(cleared.rows as Array<unknown> | undefined)?.length) {
          hostedCleanupFailed += 1;
          continue;
        }
      }
      if (!expectedUpdatedAt || !markerValue || !ownerEmail) {
        hostedCleanupFailed += 1;
        continue;
      }
      try {
        const released = await releaseHostedClipAllowanceAfterCleanup({
          recordingId: id,
          ownerEmail,
          expectedUpdatedAt,
          cleanupMarkerValue: markerValue,
          sessionKey,
        });
        if (released) hostedReservationsReleased += 1;
        else hostedCleanupFailed += 1;
      } catch (error) {
        hostedCleanupFailed += 1;
        console.warn(
          `[upload-reaper-${id}] hosted reservation release failed`,
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
        continue;
      }
    }
  }
  if (expired.length > 0 && !dryRun) {
    const ids = expired.map((row) => row.id);
    const result = await exec.execute({
      // A parked row (uploading with a reason) expired waiting for storage;
      // everything else stopped sending data.
      sql: `UPDATE recordings
            SET status = 'failed',
                failure_code = CASE
                  WHEN status = 'uploading' AND failure_reason IS NOT NULL
                  THEN 'storage_setup_required' ELSE 'upload_timed_out' END,
                failure_reason = CASE
                  WHEN status = 'uploading' AND failure_reason IS NOT NULL
                  THEN $4 ELSE $1 END,
                updated_at = $2
            WHERE status IN ('uploading', 'processing')
              AND upload_lease_expires_at < $3
              AND id IN (${ids.map((_, i) => `$${i + 5}`).join(", ")})
            RETURNING id, owner_email, upload_attempt_id, recording_platform,
                      failure_code, storage_mode, video_url`,
      args: [
        UPLOAD_LEASE_EXPIRED_REASON,
        nowIso,
        nowIso,
        WAITING_STORAGE_EXPIRED_REASON,
        ...ids,
      ],
    });

    const terminatedRows =
      (result.rows as Array<Record<string, unknown>>) ?? [];
    const terminated = new Set(terminatedRows.map((row) => String(row.id)));
    expired = expired.filter((row) => terminated.has(row.id));
    failed = terminated.size;

    for (const row of terminatedRows) {
      if (typeof row.owner_email !== "string") {
        throw new Error("Upload timeout row is missing owner email");
      }
      trackRecordingFailure({
        recordingId: String(row.id),
        userId: row.owner_email,
        uploadAttemptId:
          typeof row.upload_attempt_id === "string"
            ? row.upload_attempt_id
            : null,
        platform: normalizeRecordingPlatform(row.recording_platform),
        failureCode:
          row.failure_code === "storage_setup_required"
            ? "storage_setup_required"
            : "upload_timed_out",
      });
    }

    for (const id of terminated) {
      const generationId =
        expired.find((row) => row.id === id)?.uploadGenerationId ?? null;
      const reapedUpload = expired.find((row) => row.id === id);
      const sessionKey = resumableSessionKey(id, generationId);
      const sessionState = await readResumableSessionState(
        exec,
        "$1",
        sessionKey,
      );
      if (sessionState.present && !sessionState.session) {
        resumableCleanupFailed += 1;
        if (reapedUpload?.storageMode === "hosted") hostedCleanupFailed += 1;
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
          if (reapedUpload?.storageMode === "hosted") hostedCleanupFailed += 1;
          continue;
        }
        resumableSessionsAborted += 1;
      }

      if (reapedUpload?.storageMode !== "hosted") {
        await exec.execute({
          sql: `DELETE FROM application_state WHERE key = $1`,
          args: [sessionKey],
        });
        continue;
      }

      // A processing row with a session but no persisted URL may have completed
      // its multipart request before the process stopped. Aborting that old
      // upload ID does not prove the completed object is gone.
      if (reapedUpload.videoUrl) {
        let deleted = false;
        try {
          deleted = await deleteS3ObjectByUrl(reapedUpload.videoUrl, {
            storageMode: "hosted",
            recordingId: id,
          });
        } catch (error) {
          console.warn(`[upload-reaper-${id}] hosted media cleanup failed`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (!deleted) {
          hostedCleanupFailed += 1;
          continue;
        }
      }

      if (reapedUpload.status === "processing" && !reapedUpload.videoUrl) {
        hostedCleanupFailed += 1;
        console.warn(
          `[upload-reaper-${id}] hosted processing row has no persisted media URL; keeping its reservation`,
        );
        continue;
      }

      if (reapedUpload.videoUrl) {
        const cleared = await exec.execute({
          sql: `UPDATE recordings
                SET video_url = NULL, video_size_bytes = 0, updated_at = $1
                WHERE id = $2 AND status = 'failed' AND video_url = $3
                RETURNING id`,
          args: [nowIso, id, reapedUpload.videoUrl],
        });
        if (!(cleared.rows as Array<unknown> | undefined)?.length) {
          hostedCleanupFailed += 1;
          continue;
        }
      }
      const markerValue = await markHostedCleanupConfirmed(
        id,
        reapedUpload.videoUrl,
      );

      try {
        if (!reapedUpload?.ownerEmail) {
          hostedCleanupFailed += 1;
          continue;
        }
        const allowanceVersion = await exec.execute({
          sql: `SELECT updated_at FROM clips_hosted_clip_allowances
                WHERE recording_id = $1 AND status = 'reserved'`,
          args: [id],
        });
        const expectedUpdatedAt = (
          allowanceVersion.rows as Array<Record<string, unknown>> | undefined
        )?.[0]?.updated_at;
        const released =
          typeof expectedUpdatedAt === "string" &&
          (await releaseHostedClipAllowanceAfterCleanup({
            recordingId: id,
            ownerEmail: reapedUpload.ownerEmail,
            expectedUpdatedAt,
            cleanupMarkerValue: markerValue,
            sessionKey,
          }));
        if (released) hostedReservationsReleased += 1;
        else hostedCleanupFailed += 1;
      } catch (error) {
        hostedCleanupFailed += 1;
        console.warn(
          `[upload-reaper-${id}] hosted reservation release failed`,
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
        continue;
      }
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
    hostedReservationsReleased,
    hostedCleanupFailed,
  };
}

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
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
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

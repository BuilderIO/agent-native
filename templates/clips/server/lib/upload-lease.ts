import { getDbExec } from "@agent-native/core/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { PENDING_MEETING_FINALIZATION_STALE_MS } from "../../shared/meeting-finalization.js";
import { WAITING_STORAGE_EXPIRED_REASON } from "../../shared/upload-interruption.js";
import { getDb, schema } from "../db/index.js";
import {
  releaseHostedClipAllowanceAfterCleanup,
  writeHostedCleanupConfirmedMarker,
} from "./hosted-clip-allowance.js";
import { reconcileMeetingOnRecordingFailed } from "./reconcile-meeting-on-finalize.js";
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

const MEETING_FINALIZATION_RETRY_STATE_PREFIX = "clips-meeting-finalize-retry-";
const MAX_MEETING_FINALIZATION_DISPATCH_ATTEMPTS = 5;
const MEETING_FINALIZATION_RETRY_BASE_MS = 5 * 60 * 1000;
const MEETING_FINALIZATION_RETRY_MAX_MS = 15 * 60 * 1000;
const MAX_MEETING_FINALIZATION_DISPATCHES_PER_SWEEP = 8;
const MEETING_FINALIZATION_DISPATCH_CONCURRENCY = 4;

type MeetingFinalizationRetryState = {
  recordingId: string;
  ownerEmail: string;
  status: "scheduled" | "exhausted";
  attempts: number;
  updatedAt: string;
  nextAttemptAt: string;
};

type MeetingFinalizationDispatchClaim =
  | "claimed"
  | "waiting"
  | "exhausted"
  | "already-exhausted";

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
  meetingFinalizationRetriesExhausted: number;
}

class UploadReaperDispatchError extends Error {
  constructor(
    readonly dispatchFailures: Array<{ recordingId: string; error: unknown }>,
  ) {
    super(
      `Meeting finalization dispatch failed for ${dispatchFailures.length} recording(s): ${dispatchFailures.map(({ recordingId }) => recordingId).join(", ")}`,
    );
    this.name = "UploadReaperDispatchError";
  }
}

export async function markHostedCleanupConfirmed(
  recordingId: string,
  ownerEmail: string,
  videoUrl: string | null = null,
): Promise<string> {
  return writeHostedCleanupConfirmedMarker({
    recordingId,
    ownerEmail,
    videoUrl,
  });
}

function meetingFinalizationRetryKey(recordingId: string): string {
  return `${MEETING_FINALIZATION_RETRY_STATE_PREFIX}${recordingId}`;
}

function parseMeetingFinalizationRetryState(
  value: unknown,
  recordingId: string,
  ownerEmail: string,
): MeetingFinalizationRetryState {
  if (typeof value !== "string") {
    throw new Error(
      `Meeting finalization retry state for ${recordingId} is unreadable`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Meeting finalization retry state for ${recordingId} is malformed: ${detail}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Meeting finalization retry state for ${recordingId} is invalid`,
    );
  }
  const state = parsed as Partial<MeetingFinalizationRetryState>;
  if (
    state.recordingId !== recordingId ||
    state.ownerEmail !== ownerEmail ||
    (state.status !== "scheduled" && state.status !== "exhausted") ||
    !Number.isInteger(state.attempts) ||
    (state.attempts ?? 0) < 1 ||
    typeof state.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(state.updatedAt)) ||
    typeof state.nextAttemptAt !== "string" ||
    !Number.isFinite(Date.parse(state.nextAttemptAt))
  ) {
    throw new Error(
      `Meeting finalization retry state for ${recordingId} is invalid`,
    );
  }
  return state as MeetingFinalizationRetryState;
}

function meetingFinalizationRetryDelayMs(attempt: number): number {
  return Math.min(
    MEETING_FINALIZATION_RETRY_MAX_MS,
    MEETING_FINALIZATION_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
  );
}

async function claimMeetingFinalizationDispatch(params: {
  recordingId: string;
  ownerEmail: string;
  now: number;
}): Promise<MeetingFinalizationDispatchClaim> {
  const exec = getDbExec();
  const ownerSessionId = params.ownerEmail.trim().toLowerCase();
  const key = meetingFinalizationRetryKey(params.recordingId);
  const current = await exec.execute({
    sql: `SELECT value FROM application_state
          WHERE session_id = $1 AND key = $2`,
    args: [ownerSessionId, key],
  });
  const existing = (current.rows as Array<Record<string, unknown>>)[0];
  const oldValue = existing?.value;
  const state =
    existing === undefined
      ? null
      : parseMeetingFinalizationRetryState(
          oldValue,
          params.recordingId,
          params.ownerEmail,
        );
  if (state?.status === "exhausted") return "already-exhausted";
  if (state && Date.parse(state.nextAttemptAt) > params.now) return "waiting";

  if (state && state.attempts >= MAX_MEETING_FINALIZATION_DISPATCH_ATTEMPTS) {
    const exhaustedState: MeetingFinalizationRetryState = {
      ...state,
      status: "exhausted",
      updatedAt: new Date(params.now).toISOString(),
    };
    const exhausted = await exec.execute({
      sql: `UPDATE application_state
            SET value = $1, updated_at = $2
            WHERE session_id = $3 AND key = $4 AND value = $5
            RETURNING key`,
      args: [
        JSON.stringify(exhaustedState),
        params.now,
        ownerSessionId,
        key,
        oldValue,
      ],
    });
    return (exhausted.rows as Array<unknown>).length > 0
      ? "exhausted"
      : "waiting";
  }

  const attempts = (state?.attempts ?? 0) + 1;
  const nextState: MeetingFinalizationRetryState = {
    recordingId: params.recordingId,
    ownerEmail: params.ownerEmail,
    status: "scheduled",
    attempts,
    updatedAt: new Date(params.now).toISOString(),
    nextAttemptAt: new Date(
      params.now + meetingFinalizationRetryDelayMs(attempts),
    ).toISOString(),
  };
  const serialized = JSON.stringify(nextState);
  const claim =
    state === null
      ? await exec.execute({
          sql: `INSERT INTO application_state (session_id, key, value, updated_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (session_id, key) DO NOTHING
                RETURNING key`,
          args: [ownerSessionId, key, serialized, params.now],
        })
      : await exec.execute({
          sql: `UPDATE application_state
                SET value = $1, updated_at = $2
                WHERE session_id = $3 AND key = $4 AND value = $5
                RETURNING key`,
          args: [serialized, params.now, ownerSessionId, key, oldValue],
        });
  return (claim.rows as Array<unknown>).length > 0 ? "claimed" : "waiting";
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
  key: string,
  ownerEmail: string,
): Promise<{ present: boolean; session: StoredResumableSession | null }> {
  const result = await exec.execute({
    sql: `SELECT value FROM application_state
          WHERE LOWER(session_id) = LOWER($1) AND key = $2`,
    args: [ownerEmail.trim(), key],
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
  ownerEmail: string,
): Promise<string | null> {
  const result = await exec.execute({
    sql: `SELECT value FROM application_state
          WHERE LOWER(session_id) = LOWER($1) AND key = $2`,
    args: [ownerEmail.trim(), `recording-upload-${recordingId}`],
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
  const now = options.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const dryRun = options.dryRun === true;

  const pendingHostedReleases = await exec.execute({
    sql: `SELECT r.id, r.owner_email, r.video_url, r.upload_generation_id,
                 a.updated_at AS allowance_updated_at,
                 s.key AS cleanup_confirmed_key,
                 s.value AS cleanup_confirmed_value
          FROM recordings r
          JOIN clips_hosted_clip_allowances a ON a.recording_id = r.id
          LEFT JOIN application_state s
            ON LOWER(s.session_id) = LOWER(r.owner_email) AND s.key = $1 || r.id
          WHERE r.storage_mode = 'hosted'
            AND r.status = 'failed'
            AND a.status = 'reserved'
            AND (
              s.key IS NOT NULL
              OR r.video_url IS NOT NULL
              OR EXISTS (
                SELECT 1 FROM application_state session_state
                WHERE LOWER(session_state.session_id) = LOWER(r.owner_email)
                  AND session_state.key = CASE
                  WHEN r.upload_generation_id IS NULL
                  THEN 'resumable-session-' || r.id
                  ELSE 'resumable-session-' || r.id || '-' || r.upload_generation_id
                END
              )
              OR EXISTS (
                SELECT 1 FROM application_state upload_state
                WHERE LOWER(upload_state.session_id) = LOWER(r.owner_email)
                  AND upload_state.key = 'recording-upload-' || r.id
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
  let meetingFinalizationRetriesExhausted = 0;
  let terminatedRows: Array<Record<string, unknown>> = [];
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
      if (!ownerEmail) {
        hostedCleanupFailed += 1;
        continue;
      }
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
          sessionKey,
          ownerEmail,
        );
        if (sessionState.present && !sessionState.session) {
          hostedCleanupFailed += 1;
          continue;
        }
        const uploadStatus = !videoUrl
          ? await readUploadStateStatus(exec, id, ownerEmail)
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
            markerValue = await markHostedCleanupConfirmed(
              id,
              ownerEmail,
              videoUrl,
            );
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
          markerValue = await markHostedCleanupConfirmed(id, ownerEmail);
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

    terminatedRows = (result.rows as Array<Record<string, unknown>>) ?? [];
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
      const ownerEmail = reapedUpload?.ownerEmail;
      if (!ownerEmail) {
        resumableCleanupFailed += 1;
        continue;
      }
      const sessionState = await readResumableSessionState(
        exec,
        sessionKey,
        ownerEmail,
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
          sql: `DELETE FROM application_state
                WHERE LOWER(session_id) = LOWER($1) AND key = $2`,
          args: [ownerEmail.trim(), sessionKey],
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
      if (!reapedUpload?.ownerEmail) {
        hostedCleanupFailed += 1;
        continue;
      }
      const markerValue = await markHostedCleanupConfirmed(
        id,
        reapedUpload.ownerEmail,
        reapedUpload.videoUrl,
      );

      try {
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

  if (!dryRun) {
    const dispatchFailures: Array<{ recordingId: string; error: unknown }> = [];
    const candidateLimit = Math.min(
      limit,
      MAX_MEETING_FINALIZATION_DISPATCHES_PER_SWEEP,
    );
    const stalePendingBefore = new Date(
      now - PENDING_MEETING_FINALIZATION_STALE_MS,
    ).toISOString();
    const retryableMeetingFinalizations = await exec.execute({
      sql: `SELECT DISTINCT r.id, r.owner_email
            FROM recordings r
            WHERE r.status IN ('ready', 'failed')
              AND EXISTS (
                SELECT 1
                FROM clips_meetings m
                JOIN recording_transcripts t ON t.recording_id = m.recording_id
                WHERE m.recording_id = r.id
                  AND m.owner_email = r.owner_email
                  AND m.actual_end IS NOT NULL
                  AND (
                    m.transcript_status IN ('ready', 'failed')
                    OR (
                      m.transcript_status = 'pending'
                      AND m.updated_at < $3
                    )
                  )
                  AND m.summary_md = ''
                  AND m.trashed_at IS NULL
                  AND t.status = 'ready'
                  AND BTRIM(t.full_text) <> ''
              )
              AND NOT EXISTS (
                SELECT 1
                FROM application_state retry_state
                WHERE retry_state.session_id = LOWER(r.owner_email)
                  AND retry_state.key = $1 || r.id
                  AND (
                    retry_state.value::jsonb ->> 'status' = 'exhausted'
                    OR (
                      retry_state.value::jsonb ->> 'status' = 'scheduled'
                      AND (retry_state.value::jsonb ->> 'nextAttemptAt')::timestamptz > $2
                    )
                  )
              )
            ORDER BY r.id
            LIMIT ${candidateLimit}`,
      args: [
        MEETING_FINALIZATION_RETRY_STATE_PREFIX,
        nowIso,
        stalePendingBefore,
      ],
    });
    const dispatchCandidates = new Map<string, Record<string, unknown>>();
    for (const row of (retryableMeetingFinalizations.rows as Array<
      Record<string, unknown>
    >) ?? []) {
      dispatchCandidates.set(String(row.id), row);
    }
    const terminatedIds = terminatedRows.map((row) => String(row.id));
    const terminatedCandidateLimit = candidateLimit - dispatchCandidates.size;
    if (terminatedIds.length > 0 && terminatedCandidateLimit > 0) {
      const terminatedMeetingFinalizations = await exec.execute({
        sql: `SELECT DISTINCT r.id, r.owner_email
              FROM recordings r
              WHERE r.id IN (${terminatedIds.map((_, index) => `$${index + 1}`).join(", ")})
                AND EXISTS (
                  SELECT 1
                  FROM clips_meetings m
                  WHERE m.recording_id = r.id
                    AND m.owner_email = r.owner_email
                    AND m.actual_end IS NOT NULL
                    AND m.summary_md = ''
                    AND m.trashed_at IS NULL
                )
              ORDER BY r.id
              LIMIT ${terminatedCandidateLimit}`,
        args: terminatedIds,
      });
      for (const row of (terminatedMeetingFinalizations.rows as Array<
        Record<string, unknown>
      >) ?? []) {
        dispatchCandidates.set(String(row.id), row);
      }
    }

    const candidates = [...dispatchCandidates.values()];
    let nextCandidate = 0;
    const dispatchNextCandidate = async () => {
      while (nextCandidate < candidates.length) {
        const row = candidates[nextCandidate++];
        if (!row) continue;
        const recordingId = String(row.id);
        if (typeof row.owner_email !== "string") {
          dispatchFailures.push({
            recordingId,
            error: new Error("Upload timeout row is missing owner email"),
          });
          continue;
        }
        try {
          const claim = await claimMeetingFinalizationDispatch({
            recordingId,
            ownerEmail: row.owner_email,
            now,
          });
          if (claim === "waiting" || claim === "already-exhausted") continue;
          if (claim === "exhausted") {
            meetingFinalizationRetriesExhausted += 1;
            console.error(
              "[upload-reaper] meeting finalization retry limit exhausted",
              {
                recordingId,
                attempts: MAX_MEETING_FINALIZATION_DISPATCH_ATTEMPTS,
              },
            );
            continue;
          }
          await reconcileMeetingOnRecordingFailed({
            recordingId,
            ownerEmail: row.owner_email,
          });
        } catch (error) {
          dispatchFailures.push({ recordingId, error });
        }
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            MEETING_FINALIZATION_DISPATCH_CONCURRENCY,
            candidates.length,
          ),
        },
        dispatchNextCandidate,
      ),
    );
    if (dispatchFailures.length > 0) {
      throw new UploadReaperDispatchError(dispatchFailures);
    }
  }

  return {
    dryRun,
    expired,
    failed,
    scratchKeysDeleted,
    resumableSessionsAborted,
    resumableCleanupFailed,
    hostedReservationsReleased,
    hostedCleanupFailed,
    meetingFinalizationRetriesExhausted,
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

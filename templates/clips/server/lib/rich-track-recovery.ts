import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";

import { RETRYABLE_UPLOAD_INTERRUPTION_REASON } from "../../shared/upload-interruption.js";
import { finalizeRecordingTracks } from "../routes/api/uploads/[recordingId]/tracks/finalize.post.js";
import { claimLease, releaseLease, renewLease } from "./recording-leases.js";
import {
  deleteRichDraft,
  discardTrackUploads,
  readRichDraft,
  readSavedRichDraft,
  withdrawRichDraft,
} from "./recording-tracks.js";
import { UPLOAD_LEASE_MS } from "./upload-lease.js";

const DISCARD_LEASE_MS = 2 * 60 * 1000;

export interface TrackRecoveryResult {
  recovered: number;
  discarded: number;
  failed: number;
}

interface IdleTrackRecording {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  status: string;
  mediaFormat: string;
  storageMode: "own" | "hosted" | null;
  uploadGenerationId: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function selectIdleTrackRecordings(params: {
  cutoff: number;
  limit: number;
  recordingId?: string;
}): Promise<IdleTrackRecording[]> {
  // guard:allow-unscoped — system sweep over every owner's unfinished track uploads.
  const { rows } = await getDbExec().execute({
    sql: `WITH idle AS (
            SELECT session_id,
                   CASE WHEN key LIKE 'recording-rich-draft-%'
                        THEN substr(key, 22)
                        ELSE substring(key from '^resumable-session-(.+)-track-[a-z]+$')
                   END AS recording_id
            FROM application_state
            WHERE (key LIKE 'resumable-session-%-track-%'
                   OR key LIKE 'recording-rich-draft-%')
              AND updated_at < $1
          )
          SELECT DISTINCT r.id, r.owner_email, r.org_id, r.status,
                 r.media_format, r.storage_mode, r.upload_generation_id
          FROM idle
          JOIN recordings r
            ON r.id = idle.recording_id
           AND LOWER(r.owner_email) = LOWER(idle.session_id)
          WHERE r.trashed_at IS NULL
            AND COALESCE(r.failure_code, '') <> 'taken_down'
            AND (
              r.media_format = 'rich'
              OR r.status = 'ready'
              OR (
                r.status = 'failed'
                AND COALESCE(r.failure_reason, '') <> $2
                AND COALESCE(r.failure_reason, '') NOT LIKE $3
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM application_state fresh
              WHERE fresh.session_id = idle.session_id
                AND fresh.updated_at >= $1
                AND (
                  fresh.key = 'recording-rich-draft-' || r.id
                  OR (
                    fresh.key LIKE 'resumable-session-%-track-%'
                    AND substring(fresh.key from '^resumable-session-(.+)-track-[a-z]+$') = r.id
                  )
                )
            )
            AND NOT EXISTS (
              SELECT 1 FROM clips_backfill_leases held
              WHERE held.lease_key = 'rich-track-recovery:' || r.id
                AND held.expires_at > $4
            )
            AND ($5::text IS NULL OR r.id = $5::text)
          ORDER BY r.id
          LIMIT $6`,
    args: [
      params.cutoff,
      RETRYABLE_UPLOAD_INTERRUPTION_REASON,
      `${RETRYABLE_UPLOAD_INTERRUPTION_REASON} Last error:%`,
      Date.now(),
      params.recordingId ?? null,
      params.limit,
    ],
  });
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    ownerEmail: String(row.owner_email).trim().toLowerCase(),
    orgId: typeof row.org_id === "string" ? row.org_id : null,
    status: String(row.status),
    mediaFormat: String(row.media_format),
    storageMode:
      row.storage_mode === "own" || row.storage_mode === "hosted"
        ? row.storage_mode
        : null,
    uploadGenerationId:
      typeof row.upload_generation_id === "string"
        ? row.upload_generation_id
        : null,
  }));
}

async function selectIdleTrackRecording(
  cutoff: number,
  recordingId: string,
): Promise<IdleTrackRecording | null> {
  const found = await selectIdleTrackRecordings({
    cutoff,
    limit: 1,
    recordingId,
  });
  return found.find((row) => row.id === recordingId) ?? null;
}

async function discardIdleTracks(
  recording: IdleTrackRecording,
  cutoff: number,
): Promise<keyof TrackRecoveryResult | null> {
  const lease = await claimLease(
    `rich-finalize:${recording.id}`,
    DISCARD_LEASE_MS,
  );
  if (!lease) return "failed";
  try {
    const current = await selectIdleTrackRecording(cutoff, recording.id);
    if (
      !current ||
      current.uploadGenerationId !== recording.uploadGenerationId
    ) {
      return null;
    }
    const draft = await readSavedRichDraft(current.id);
    const left = await discardTrackUploads(
      {
        id: current.id,
        ownerEmail: current.ownerEmail,
        storageMode: current.storageMode,
      },
      { lease, stillHeld: () => renewLease(lease, DISCARD_LEASE_MS) },
    );
    if (left.length) {
      console.warn(
        `[track-recovery] still stored after discarding: ${left.join(", ")}`,
      );
      return "failed";
    }
    if (draft) await withdrawRichDraft(current.id, draft, lease);
    return "discarded";
  } finally {
    await releaseLease(lease);
  }
}

async function settleIdleTracks(
  recordingId: string,
  cutoff: number,
): Promise<keyof TrackRecoveryResult | null> {
  const recording = await selectIdleTrackRecording(cutoff, recordingId);
  if (!recording) return null;
  if (recording.mediaFormat === "flat" && recording.status === "ready") {
    const draft = await readRichDraft(recording.id);
    if (
      draft &&
      (draft.uploadGenerationId ?? null) === recording.uploadGenerationId
    ) {
      const finalized = await finalizeRecordingTracks({
        recordingId: recording.id,
        input: draft,
        ownerEmail: recording.ownerEmail,
        ...(recording.orgId ? { orgId: recording.orgId } : {}),
        setStatus: () => {},
      });
      if ("mediaFormat" in finalized && finalized.mediaFormat === "rich") {
        await deleteRichDraft(recording.id);
        return "recovered";
      }
      if ("retryable" in finalized && finalized.retryable === true) {
        return "failed";
      }
    }
  }
  return discardIdleTracks(recording, cutoff);
}

async function holdOff(recordingId: string): Promise<void> {
  try {
    await claimLease(`rich-track-recovery:${recordingId}`, UPLOAD_LEASE_MS);
  } catch (error) {
    console.warn(
      `[track-recovery] ${recordingId} was not held off:`,
      errorMessage(error),
    );
  }
}

export async function recoverIdleTrackUploads(
  options: { now?: number; limit?: number } = {},
): Promise<TrackRecoveryResult> {
  const cutoff = (options.now ?? Date.now()) - UPLOAD_LEASE_MS;
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const candidates = await selectIdleTrackRecordings({ cutoff, limit });

  const result: TrackRecoveryResult = { recovered: 0, discarded: 0, failed: 0 };
  for (const candidate of candidates) {
    let outcome: keyof TrackRecoveryResult | null;
    try {
      outcome = await runWithRequestContext(
        { userEmail: candidate.ownerEmail },
        () => settleIdleTracks(candidate.id, cutoff),
      );
    } catch (error) {
      outcome = "failed";
      console.warn(
        `[track-recovery] tracks of ${candidate.id} were not settled:`,
        errorMessage(error),
      );
    }
    if (outcome === null) continue;
    result[outcome] += 1;
    if (outcome === "failed") await holdOff(candidate.id);
  }
  return result;
}

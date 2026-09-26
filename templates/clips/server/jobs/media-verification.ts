import {
  compareAndSetManyAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";

import finalizeRecording from "../../actions/finalize-recording.js";
import { getDb, schema } from "../db/index.js";
import {
  MEDIA_VERIFICATION_STATE_PREFIX,
  mediaVerificationMarkerMatchesUpload,
  parseMediaVerificationMarker,
} from "../lib/media-verification-state.js";
import { ownerEmailMatches } from "../lib/recordings.js";

const SWEEP_INTERVAL_MS = 60_000;
const DISPATCH_FALLBACK_GRACE_MS = 30_000;
const MAX_ATTEMPTS = 10;
let skippingLogged = false;

export async function runMediaVerificationSweepOnce(): Promise<void> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT session_id, key, value FROM application_state WHERE key LIKE $1`,
    args: [`${MEDIA_VERIFICATION_STATE_PREFIX}%`],
  });
  const now = Date.now();

  for (const row of rows as Array<{
    session_id?: unknown;
    key?: unknown;
    value?: unknown;
  }>) {
    const sessionId =
      typeof row.session_id === "string" ? row.session_id.trim() : "";
    const key = typeof row.key === "string" ? row.key : "";
    const recordingId = key.startsWith(MEDIA_VERIFICATION_STATE_PREFIX)
      ? key.slice(MEDIA_VERIFICATION_STATE_PREFIX.length)
      : "";
    const rawValue = typeof row.value === "string" ? row.value : "";
    let rawState: unknown;
    try {
      rawState = JSON.parse(rawValue);
    } catch {
      continue;
    }
    const marker = parseMediaVerificationMarker(rawState);
    if (
      !sessionId ||
      !recordingId ||
      !marker ||
      marker.recordingId !== recordingId
    ) {
      continue;
    }

    const nextAttemptAt = Date.parse(marker.nextAttemptAt);
    const leaseUntil = marker.leaseUntil
      ? Date.parse(marker.leaseUntil)
      : Number.NEGATIVE_INFINITY;
    const due =
      marker.status === "pending"
        ? now >= nextAttemptAt + DISPATCH_FALLBACK_GRACE_MS
        : now >= leaseUntil;
    const hasActiveLease = leaseUntil > now;
    if (marker.completedAttempts >= MAX_ATTEMPTS || !due || hasActiveLease) {
      continue;
    }

    try {
      const [recording] = await getDb()
        .select({
          ownerEmail: schema.recordings.ownerEmail,
          authUserId: schema.recordings.authUserId,
          orgId: schema.recordings.orgId,
          videoUrl: schema.recordings.videoUrl,
          uploadAttemptId: schema.recordings.uploadAttemptId,
          uploadGenerationId: schema.recordings.uploadGenerationId,
        })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, recordingId),
            ownerEmailMatches(schema.recordings.ownerEmail, sessionId),
            eq(schema.recordings.status, "processing"),
            isNull(schema.recordings.trashedAt),
          ),
        )
        .limit(1);
      if (!recording) continue;
      const uploadAttemptId = recording.uploadAttemptId ?? null;
      const uploadGenerationId = recording.uploadGenerationId ?? null;
      const hasAttemptIdentity = marker.uploadAttemptId !== undefined;
      const hasGenerationIdentity = marker.uploadGenerationId !== undefined;
      if (
        hasAttemptIdentity !== hasGenerationIdentity ||
        (hasAttemptIdentity &&
          !mediaVerificationMarkerMatchesUpload(
            marker,
            uploadAttemptId,
            uploadGenerationId,
          ))
      ) {
        continue;
      }

      await runWithRequestContext(
        {
          userEmail: recording.ownerEmail,
          authUserId: recording.authUserId ?? undefined,
          orgId: recording.orgId ?? undefined,
        },
        async () => {
          if (!hasAttemptIdentity) {
            const uploadStateKey = `recording-upload-${recordingId}`;
            const uploadStateRaw = await readAppState(uploadStateKey);
            if (!uploadStateRaw || typeof uploadStateRaw !== "object") return;
            const uploadState = uploadStateRaw as Record<string, unknown>;
            const videoUrl =
              typeof uploadState.videoUrl === "string"
                ? uploadState.videoUrl
                : "";
            const hasUploadAttemptIdentity =
              uploadState.uploadAttemptId !== undefined;
            const hasUploadGenerationIdentity =
              uploadState.uploadGenerationId !== undefined;
            if (
              uploadState.recordingId !== recordingId ||
              uploadState.status !== "processing" ||
              uploadState.pendingMediaVerification !== true ||
              uploadState.mediaVerificationAttempt !==
                marker.completedAttempts ||
              !videoUrl.trim() ||
              recording.videoUrl !== videoUrl ||
              hasUploadAttemptIdentity !== hasUploadGenerationIdentity ||
              (hasUploadAttemptIdentity &&
                (uploadState.uploadAttemptId !== uploadAttemptId ||
                  uploadState.uploadGenerationId !== uploadGenerationId))
            ) {
              return;
            }

            const uploadStateTagged = await compareAndSetManyAppState([
              {
                key,
                expectedValue: rawState as Record<string, unknown>,
                nextValue: {
                  ...(rawState as Record<string, unknown>),
                  uploadAttemptId,
                  uploadGenerationId,
                },
              },
              {
                key: uploadStateKey,
                expectedValue: uploadState,
                nextValue: {
                  ...uploadState,
                  uploadAttemptId,
                  uploadGenerationId,
                },
              },
            ]);
            if (!uploadStateTagged) return;
          }

          await finalizeRecording.run({
            id: recordingId,
            mediaVerificationRetryAttempt: Math.min(
              MAX_ATTEMPTS,
              marker.completedAttempts + 1,
            ),
            uploadAttemptId,
            uploadGenerationId: uploadGenerationId ?? undefined,
          });
        },
      );
    } catch (err) {
      console.warn("[media-verification] sweep item failed", {
        key: typeof row.key === "string" ? row.key : "",
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export default function registerMediaVerificationJob(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[media-verification] Skipping background sweep (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }

  setInterval(() => {
    runMediaVerificationSweepOnce().catch((err) =>
      console.error("[media-verification] interval failed:", err),
    );
  }, SWEEP_INTERVAL_MS);
  console.log(
    `[media-verification] Recurring recovery sweep every ${SWEEP_INTERVAL_MS / 1000}s.`,
  );
}

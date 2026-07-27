import { randomUUID } from "node:crypto";

import {
  runWithRequestContext,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { z } from "zod";

import exportToBrain from "../../../../actions/export-to-brain.js";
import finalizeRecording from "../../../../actions/finalize-recording.js";
import { ensureRecordingSeekable } from "../../../../actions/lib/ensure-seekable-video.js";
import { runLoomImportJob } from "../../../../actions/lib/loom-import-job.js";
import requestTranscript from "../../../../actions/request-transcript.js";
import { getDb, schema } from "../../../db/index.js";
import {
  dispatchPostFinalizeJob,
  POST_FINALIZE_JOB_TOKEN_KIND,
  postFinalizeJobResourceId,
} from "../../../lib/post-finalize-dispatch.js";

const bodySchema = z.object({
  recordingId: z.string().min(1).max(200),
  kind: z.enum([
    "media-ready",
    "seekable",
    "transcript",
    "brain-export",
    "loom-import",
  ]),
  token: z.string().min(1),
  delayMs: z.number().int().min(0).max(30_000).optional(),
  retryAttempt: z.number().int().min(1).max(10).optional(),
  regenerate: z.boolean().optional(),
});

const LOOM_IMPORT_LEASE_MS = 30 * 60 * 1000;

export default defineEventHandler(async (event: H3Event) => {
  const parsed = bodySchema.safeParse(await readBody(event).catch(() => null));
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return { ok: false, error: "Invalid post-finalize job" };
  }

  const { recordingId, kind, token, delayMs, retryAttempt, regenerate } =
    parsed.data;
  const verified = verifyScopedAgentAccessToken(token, {
    resourceKind: POST_FINALIZE_JOB_TOKEN_KIND,
    resourceId: postFinalizeJobResourceId(recordingId, kind),
  });
  if (!verified.ok) {
    setResponseStatus(event, 401);
    return { ok: false, error: "Invalid or expired post-finalize job token" };
  }

  const [recording] = await getDb()
    .select({
      id: schema.recordings.id,
      ownerEmail: schema.recordings.ownerEmail,
      orgId: schema.recordings.orgId,
      status: schema.recordings.status,
      uploadGenerationId: schema.recordings.uploadGenerationId,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);
  if (!recording) {
    setResponseStatus(event, 404);
    return { ok: false, error: "Recording not found" };
  }
  const requiredStatus =
    kind === "media-ready" || kind === "loom-import" ? "processing" : "ready";
  if (recording.status !== requiredStatus) {
    return {
      ok: true,
      recordingId,
      kind,
      skipped: true,
      reason: `recording-${recording.status}`,
    };
  }

  return runWithRequestContext(
    {
      userEmail: recording.ownerEmail,
      orgId: recording.orgId ?? undefined,
    },
    async () => {
      if (delayMs) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        await dispatchPostFinalizeJob({
          recordingId,
          kind,
          retryAttempt,
          regenerate,
          requireAccepted: kind === "media-ready",
        });
        return {
          ok: true,
          recordingId,
          kind,
          retryAttempt,
          dispatchedAfterMs: delayMs,
        };
      }
      if (kind === "seekable") {
        const result = await ensureRecordingSeekable({
          recordingId,
          ownerEmail: recording.ownerEmail,
        });
        return { ok: true, kind, result };
      }
      if (kind === "media-ready") {
        const result = await finalizeRecording.run({
          id: recordingId,
          mediaVerificationRetryAttempt: retryAttempt ?? 1,
          ...(recording.uploadGenerationId
            ? { uploadGenerationId: recording.uploadGenerationId }
            : {}),
        });
        return { ok: true, kind, result };
      }

      if (kind === "loom-import") {
        const claimId = randomUUID();
        const claimStartedAt = new Date().toISOString();
        const claimExpiredBefore = new Date(
          Date.now() - LOOM_IMPORT_LEASE_MS,
        ).toISOString();
        const [claimed] = await getDb()
          .update(schema.recordings)
          .set({
            loomImportClaimId: claimId,
            loomImportClaimedAt: claimStartedAt,
          })
          .where(
            and(
              eq(schema.recordings.id, recordingId),
              eq(schema.recordings.status, "processing"),
              or(
                isNull(schema.recordings.loomImportClaimId),
                isNull(schema.recordings.loomImportClaimedAt),
                lt(schema.recordings.loomImportClaimedAt, claimExpiredBefore),
              ),
            ),
          )
          .returning({ id: schema.recordings.id });
        if (!claimed) {
          return {
            ok: true,
            recordingId,
            kind,
            skipped: true,
            reason: "loom-import-already-running",
          };
        }
        const result = await runLoomImportJob({
          recordingId,
          ownerEmail: recording.ownerEmail,
          claimId,
        });
        return { ok: true, kind, result };
      }

      if (kind === "brain-export") {
        const result = await exportToBrain.run({
          recordingId,
          retryAttempt,
        });
        return { ok: true, kind, result };
      }

      const result = await requestTranscript.run({
        recordingId,
        force: true,
        retryAttempt,
        regenerate,
      });
      return { ok: true, kind, result };
    },
  );
});

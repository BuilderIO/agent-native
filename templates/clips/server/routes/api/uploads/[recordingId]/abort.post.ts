/**
 * Abort an in-flight recording upload. Clears any stashed chunks and marks
 * the recording row as failed so the UI can reflect the state.
 *
 * Route: POST /api/uploads/:recordingId/abort
 */

import {
  readAppState,
  writeAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";
import { runWithRequestContext } from "@agent-native/core/server";
import { isStoredButUnservableFinalizeError } from "@shared/finalize-recovery.js";
import { and, eq } from "drizzle-orm";
import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "../../../../db/index.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../lib/recordings.js";
import { deleteResumableSession } from "../../../../lib/resumable-session.js";

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const { userEmail: ownerEmail, orgId } = await getEventOwnerContext(event);
  const body = (await readBody(event).catch(() => null)) as {
    reason?: unknown;
  } | null;
  const failureReason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 1000)
      : "Upload aborted by user";

  return runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
    const db = getDb();

    const [existing] = await db
      .select({
        id: schema.recordings.id,
        status: schema.recordings.status,
        videoUrl: schema.recordings.videoUrl,
        failureReason: schema.recordings.failureReason,
      })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );

    if (!existing) {
      setResponseStatus(event, 404);
      return { error: "Recording not found" };
    }

    if (existing.status === "ready" && existing.videoUrl) {
      return { ok: true, recordingId, alreadyReady: true, chunksCleared: 0 };
    }

    const preserveRecoveryState =
      isStoredButUnservableFinalizeError(failureReason) ||
      isStoredButUnservableFinalizeError(existing.failureReason);

    // Already a terminal failure (e.g. a duplicate/retried abort call, or
    // finalize's own failChunkAssembly already flipped it) — no-op instead of
    // re-clearing chunk state and overwriting the original failureReason.
    if (existing.status === "failed" && !preserveRecoveryState) {
      return { ok: true, recordingId, alreadyFailed: true, chunksCleared: 0 };
    }

    const now = new Date().toISOString();
    await db
      .update(schema.recordings)
      .set({
        status: "failed",
        failureReason,
        updatedAt: now,
      })
      .where(eq(schema.recordings.id, recordingId));

    const existingUploadStateRaw = await readAppState(
      `recording-upload-${recordingId}`,
    ).catch(() => null);
    const existingUploadState =
      existingUploadStateRaw && typeof existingUploadStateRaw === "object"
        ? (existingUploadStateRaw as Record<string, unknown>)
        : {};
    await writeAppState(`recording-upload-${recordingId}`, {
      ...existingUploadState,
      recordingId,
      status: "failed",
      failureReason,
      updatedAt: now,
    });

    const cleared = preserveRecoveryState
      ? 0
      : await deleteAppStateByPrefix(`recording-chunks-${recordingId}-`);
    if (!preserveRecoveryState) {
      await deleteResumableSession(recordingId).catch(() => {});
    }
    await writeAppState("refresh-signal", { ts: Date.now() });

    return { ok: true, recordingId, chunksCleared: cleared };
  });
});

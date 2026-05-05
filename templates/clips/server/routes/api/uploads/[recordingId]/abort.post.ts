/**
 * Abort an in-flight recording upload. Clears any stashed chunks and marks
 * the recording row as failed so the UI can reflect the state.
 *
 * Route: POST /api/uploads/:recordingId/abort
 */

import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db/index.js";
import { getEventOwnerEmail } from "../../../../lib/recordings.js";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  writeAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const ownerEmail = await getEventOwnerEmail(event);
  const body = (await readBody(event).catch(() => null)) as {
    reason?: unknown;
  } | null;
  const failureReason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 1000)
      : "Upload aborted by user";

  return runWithRequestContext({ userEmail: ownerEmail }, async () => {
    const db = getDb();

    const [existing] = await db
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          eq(schema.recordings.ownerEmail, ownerEmail),
        ),
      );

    if (!existing) {
      setResponseStatus(event, 404);
      return { error: "Recording not found" };
    }

    const cleared = await deleteAppStateByPrefix(
      `recording-chunks-${recordingId}-`,
    );

    const now = new Date().toISOString();
    await db
      .update(schema.recordings)
      .set({
        status: "failed",
        failureReason,
        updatedAt: now,
      })
      .where(eq(schema.recordings.id, recordingId));

    await writeAppState(`recording-upload-${recordingId}`, {
      recordingId,
      status: "failed",
      failureReason,
      updatedAt: now,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });

    return { ok: true, recordingId, chunksCleared: cleared };
  });
});

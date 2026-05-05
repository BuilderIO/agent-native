/**
 * Reset chunk scratch space for a recording without aborting the recording
 * itself. Used by the recorder when it needs to discard the chunks it
 * already streamed up (because they're going to be replaced with a
 * compressed blob) — without flipping the row to `failed`, which is what
 * `abort.post.ts` does.
 *
 * Optionally accepts compression metadata in the body — surfaced into
 * `recording-upload-{id}` so:
 *   1. `finalize-recording` can include it in `captureRouteError` extras
 *      (so Sentry tells us originalBytes / compressedBytes / ratio if the
 *      Builder.io upload still fails after compression).
 *   2. The library card can show "Compressed from XXX MB" if we want to
 *      surface that in the UI later.
 *
 * Route: POST /api/uploads/:recordingId/reset-chunks
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
  readAppState,
  writeAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";

interface CompressionMeta {
  originalBytes?: number;
  compressedBytes?: number;
  ratio?: number;
  elapsedMs?: number;
  outputMimeType?: string;
}

function pickNumber(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function pickString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const ownerEmail = await getEventOwnerEmail(event);
  const body = (await readBody(event).catch(() => null)) as {
    compression?: CompressionMeta | null;
  } | null;

  // Sanitize compression metadata. The recorder is the only client we trust
  // here, but the values land in Sentry extras — so we still bound them to
  // numbers / strings to avoid surprise.
  const compression: CompressionMeta | null = body?.compression
    ? {
        originalBytes: pickNumber(body.compression.originalBytes),
        compressedBytes: pickNumber(body.compression.compressedBytes),
        ratio: pickNumber(body.compression.ratio),
        elapsedMs: pickNumber(body.compression.elapsedMs),
        outputMimeType: pickString(body.compression.outputMimeType, 120),
      }
    : null;

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

    // Reset the per-recording upload progress and stash the compression
    // metadata next to it so `finalize-recording` (and the UI poller) can
    // see it.
    const now = new Date().toISOString();
    const previousState =
      ((await readAppState(`recording-upload-${recordingId}`)) as Record<
        string,
        unknown
      > | null) ?? {};
    await writeAppState(`recording-upload-${recordingId}`, {
      ...previousState,
      recordingId,
      status: "uploading",
      progress: 0,
      chunksReceived: 0,
      compression: compression ?? previousState.compression ?? null,
      updatedAt: now,
    });

    await db
      .update(schema.recordings)
      .set({
        uploadProgress: 0,
        updatedAt: now,
      })
      .where(eq(schema.recordings.id, recordingId));

    return {
      ok: true,
      recordingId,
      chunksCleared: cleared,
      compressionRecorded: !!compression,
    };
  });
});

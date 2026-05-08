/**
 * Reset chunk scratch space for a recording without aborting the recording
 * itself. Used by the recorder when it needs to discard the chunks it
 * already streamed up (because they're going to be replaced with a
 * compressed blob) — without flipping the row to `failed`, which is what
 * `abort.post.ts` does.
 *
 * Optionally accepts compression metadata in the body — surfaced into
 * `recording-compression-{id}` (a separate sub-key from
 * `recording-upload-{id}`) so:
 *   1. `finalize-recording` can include it in `captureRouteError` extras
 *      (so Sentry tells us originalBytes / compressedBytes / ratio if the
 *      Builder.io upload still fails after compression).
 *   2. The library card can show "Compressed from XXX MB" if we want to
 *      surface that in the UI later.
 *
 * The dedicated sub-key is important: the recorder's own `onChunk`
 * callback overwrites `recording-upload-{id}` whole-cloth on every chunk
 * upload (it's the simplest way to drive the progress poller), so storing
 * compression metadata there would have it clobbered the moment the
 * post-compression re-upload starts. The separate key is read-only from
 * the compression path's perspective.
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
import { getEventOwnerContext } from "../../../../lib/recordings.js";
import { runWithRequestContext } from "@agent-native/core/server";
import {
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

  const { userEmail: ownerEmail, orgId } = await getEventOwnerContext(event);
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

  return runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
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

    // Reset the per-recording upload progress so the UI poller sees the
    // re-upload restart from 0 and doesn't briefly show "100% then
    // re-running" on the post-compression chunked upload pass.
    const now = new Date().toISOString();
    await writeAppState(`recording-upload-${recordingId}`, {
      recordingId,
      status: "uploading",
      progress: 0,
      chunksReceived: 0,
      updatedAt: now,
    });

    // Stash compression metadata under its own key. We don't merge it into
    // `recording-upload-{id}` because the recorder client overwrites that
    // key on every chunk upload — any compression context written there
    // would be clobbered before `finalize-recording` could read it.
    if (compression) {
      await writeAppState(`recording-compression-${recordingId}`, {
        recordingId,
        ...compression,
        recordedAt: now,
      });
    }

    await db
      .update(schema.recordings)
      .set({
        status: "uploading",
        failureReason: null,
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

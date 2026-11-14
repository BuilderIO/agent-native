import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getActiveFileUploadProviderForRequest } from "@agent-native/core/file-upload";
import { getRequestOrgId } from "@agent-native/core/server";
import { z } from "zod";

import { parseEdits, serializeEdits } from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import {
  getCurrentOwnerEmail,
  getDefaultRecordingVisibility,
} from "../server/lib/recordings.js";
import { isS3ObjectUrlBoundToRecording } from "../server/lib/s3-upload-provider.js";
import {
  assertStitchCapacity,
  insertStitchJob,
  StitchQueueFullError,
} from "../server/lib/stitch-job-store.js";
// Without a videoUrl the server combines the clips in a durable job.
import {
  dispatchStitchJob,
  isFfprobeAvailable,
  loadOwnedStitchSources,
  parseSourceRecordingIds,
  StitchLimitError,
} from "../server/lib/stitch-job.js";
import { isFfmpegAvailable } from "../server/lib/video-remux.js";

export default defineAction({
  description:
    "Stitch multiple recordings into a new recording, in the given order. Returns the new recording id at once with status 'processing'; the server combines the videos in the background (stream copy when they match, otherwise a re-encode) and the recording turns 'ready', or 'failed' with a reason. Passing an already-combined videoUrl creates it ready instead.",
  schema: z.object({
    recordingId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{8,128}$/)
      .optional()
      .describe(
        "Pre-reserved destination ID used to bind S3-backed media. Optional for backward compatibility with other upload providers.",
      ),
    sourceRecordingIds: z
      .union([z.string(), z.array(z.string())])
      .describe("Ordered list of source recording IDs (or JSON-encoded array)"),
    title: z.string().optional().describe("Title for the stitched recording"),
    visibility: z
      .enum(["private", "org", "public"])
      .optional()
      .describe(
        "Visibility for the new recording. When omitted, uses the organization default and falls back to public.",
      ),
    videoUrl: z
      .string()
      .optional()
      .describe(
        "URL of an already-combined video. Omit it to let the server combine the recordings.",
      ),
    durationMs: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Duration in ms of the stitched video"),
    width: z.coerce.number().int().optional(),
    height: z.coerce.number().int().optional(),
    folderId: z.string().nullish(),
  }),
  run: async (args, actionContext) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const videoUrl = args.videoUrl?.trim() || null;
    if (videoUrl?.startsWith("data:")) {
      throw new Error(
        "Stitched videos must be uploaded to Builder.io or S3-compatible storage before creating a recording.",
      );
    }

    const ids = parseSourceRecordingIds(args.sourceRecordingIds);
    // The size limits bound what the server downloads; a stitch combined in
    // the browser (videoUrl) downloads nothing here.
    const ordered = await loadOwnedStitchSources(ids, ownerEmail, {
      checkSizes: !videoUrl,
    }).catch((error: unknown) => {
      if (!(error instanceof StitchLimitError)) throw error;
      fail(error.message, { errorCode: "stitch_too_large", statusCode: 413 });
    });
    if (!videoUrl && (!isFfmpegAvailable() || !isFfprobeAvailable())) {
      fail(
        "Recordings are combined with ffmpeg, which is not available on this server.",
        { errorCode: "stitch_ffmpeg_unavailable", statusCode: 424 },
      );
    }
    // The stitched video is saved with the destination's own provider, which
    // the job resolves again from the recording's storage mode. Hosted Clips
    // storage keeps the browser stitch, as before.
    const storageProvider = videoUrl
      ? null
      : await getActiveFileUploadProviderForRequest();
    if (!videoUrl && !storageProvider) {
      fail(
        "Combining recordings on the server needs your own video storage, which is not available on this server.",
        { errorCode: "stitch_storage_unavailable", statusCode: 424 },
      );
    }
    const organizationId = ordered[0].organizationId;
    const visibility = await getDefaultRecordingVisibility(
      organizationId,
      actionContext?.userEmail ?? ownerEmail,
      args.visibility,
    );

    const totalDuration =
      args.durationMs ??
      ordered.reduce((sum, r) => sum + (r.durationMs || 0), 0);

    const width =
      args.width ?? Math.max(...ordered.map((r) => r.width || 0), 0);
    const height =
      args.height ?? Math.max(...ordered.map((r) => r.height || 0), 0);

    const id = args.recordingId ?? randomUUID();
    if (videoUrl) {
      const isBound = await isS3ObjectUrlBoundToRecording(videoUrl, id);
      if (isBound === false) {
        throw new Error(
          "The stitched upload is not bound to its destination recording.",
        );
      }
    }
    const now = new Date().toISOString();

    const edits = parseEdits("{}");
    edits.stitchedFrom = ids;
    edits.mediaStorageLayout = "external";

    const recordingValues = {
      id,
      organizationId,
      orgId: organizationId,
      folderId: args.folderId ?? null,
      title: args.title?.trim() || "Stitched recording",
      status: videoUrl ? "ready" : "processing",
      uploadProgress: videoUrl ? 100 : 0,
      videoUrl,
      videoFormat: "mp4",
      durationMs: totalDuration,
      width,
      height,
      hasAudio: ordered.some((r) => Boolean(r.hasAudio)),
      hasCamera: ordered.some((r) => Boolean(r.hasCamera)),
      editsJson: serializeEdits(edits),
      ownerEmail,
      visibility,
      createdAt: now,
      updatedAt: now,
      // A server stitch gets its own thumbnail once the video is ready.
      thumbnailUrl: videoUrl ? (ordered[0].thumbnailUrl ?? null) : null,
      thumbnailStatus: videoUrl ? undefined : "pending",
      ...(videoUrl ? {} : { storageMode: "own" }),
    } as any;

    if (videoUrl) {
      await db.insert(schema.recordings).values(recordingValues);
    } else {
      // The recording and its job are one unit: a recording left processing
      // without a job row would never be picked up.
      try {
        await db.transaction(async (tx) => {
          await assertStitchCapacity(ownerEmail, tx);
          await tx.insert(schema.recordings).values(recordingValues);
          await insertStitchJob(
            {
              recordingId: id,
              ownerEmail,
              orgId: getRequestOrgId() ?? organizationId ?? null,
              sourceRecordingIds: ids,
              storageProviderId: storageProvider?.id ?? null,
            },
            tx,
          );
        });
      } catch (error) {
        if (!(error instanceof StitchQueueFullError)) throw error;
        fail(error.message, {
          errorCode: "stitch_queue_full",
          statusCode: 429,
          details: { scope: error.scope },
        });
      }
    }

    if (videoUrl && !ordered[0].thumbnailUrl) {
      await dispatchPostFinalizeJob({
        recordingId: id,
        kind: "thumbnail",
        requireAccepted: true,
      });
    }

    if (!videoUrl) {
      // The upload state is only a progress hint for the UI; the recording
      // row is the source of truth. Write it before the job is dispatched, so
      // a fast job failure (which writes "failed") always lands after it.
      await writeAppState(`recording-upload-${id}`, {
        recordingId: id,
        status: "processing",
        stage: "server-stitch",
        sourceRecordingIds: ids,
        startedAt: now,
      }).catch((error: unknown) => {
        console.warn("[stitch-recordings] upload state write failed", {
          recordingId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      // The job row is committed: when this dispatch is lost, the recovery
      // sweep dispatches the job, so a failure here must not fail the action.
      await dispatchStitchJob(id).catch((error: unknown) => {
        console.warn("[stitch-recordings] stitch dispatch failed", {
          recordingId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    // Only a hint for open lists; the recording already exists.
    await writeAppState("refresh-signal", { ts: Date.now() }).catch(
      (error: unknown) => {
        console.warn("[stitch-recordings] refresh signal failed", {
          recordingId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );

    console.log(
      `Created stitched recording ${id} from ${ids.length} sources (${totalDuration}ms)`,
    );

    return {
      id,
      sourceRecordingIds: ids,
      status: videoUrl ? ("ready" as const) : ("processing" as const),
      durationMs: totalDuration,
    };
  },
});

import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { and, inArray } from "drizzle-orm";
import { z } from "zod";

import { parseEdits, serializeEdits } from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import {
  getCurrentOwnerEmail,
  getDefaultRecordingVisibility,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import { isS3ObjectUrlBoundToRecording } from "../server/lib/s3-upload-provider.js";
import { assertNativeRecordingMedia } from "./lib/native-media.js";

export default defineAction({
  description:
    "Stitch multiple recordings into a new recording. The client-side editor is expected to concat the video files via ffmpeg.wasm and pass in the uploaded videoUrl + durationMs. Returns the new recording id.",
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
      .describe("URL of the pre-stitched video (from ffmpeg.wasm + upload)"),
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

    let ids: string[];
    if (typeof args.sourceRecordingIds === "string") {
      try {
        ids = JSON.parse(args.sourceRecordingIds);
      } catch {
        ids = args.sourceRecordingIds.split(",").map((s) => s.trim());
      }
    } else {
      ids = args.sourceRecordingIds;
    }
    ids = ids.filter((s) => typeof s === "string" && s.length > 0);
    if (ids.length < 2) {
      throw new Error("stitch-recordings needs at least 2 sourceRecordingIds");
    }

    const sources = await db
      .select()
      .from(schema.recordings)
      .where(
        and(
          inArray(schema.recordings.id, ids),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    if (sources.length !== ids.length) {
      throw new Error(
        `Not all source recordings were found: asked for ${ids.length}, got ${sources.length}`,
      );
    }

    const byId = new Map(sources.map((s) => [s.id, s]));
    const ordered = ids.map((id) => byId.get(id)!);
    for (const source of ordered) {
      assertNativeRecordingMedia(source);
    }
    const organizationId = ordered[0].organizationId;
    const defaultVisibility = await getDefaultRecordingVisibility(
      organizationId,
      actionContext?.userEmail ?? ownerEmail,
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

    await db.insert(schema.recordings).values({
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
      visibility: args.visibility ?? defaultVisibility,
      createdAt: now,
      updatedAt: now,
      thumbnailUrl: ordered[0].thumbnailUrl ?? null,
    } as any);

    if (videoUrl && !ordered[0].thumbnailUrl) {
      await dispatchPostFinalizeJob({
        recordingId: id,
        kind: "thumbnail",
        requireAccepted: true,
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    if (!videoUrl) {
      await writeAppState(`recording-upload-${id}`, {
        recordingId: id,
        status: "pending-stitch-upload",
        sourceRecordingIds: ids,
        startedAt: now,
      });
    }

    console.log(
      `Created stitched recording ${id} from ${ids.length} sources (${totalDuration}ms)`,
    );

    return {
      id,
      sourceRecordingIds: ids,
      status: videoUrl ? ("ready" as const) : ("processing" as const),
      durationMs: totalDuration,
      uploadChunkUrlTemplate: videoUrl
        ? null
        : `/api/uploads/${id}/chunk?index={index}&total={total}&isFinal={isFinal}`,
    };
  },
});

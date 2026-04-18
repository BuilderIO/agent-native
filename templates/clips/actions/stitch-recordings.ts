/**
 * Stitch multiple recordings together into a new recording.
 *
 * Implementation choice — CLIENT-SIDE FFMPEG CONCAT:
 *
 * We chose to produce a **real** combined video rather than a virtual playlist
 * that derives from editsJson. The combined video is easier to play back in
 * share links, embeds, and downstream consumers (no special player needed).
 *
 * Expected flow:
 *   1. The UI ("Stitch" dialog in `stitch-manager.tsx`) collects the source
 *      recordings in order.
 *   2. It fetches each source video via `/api/video/:id`, concatenates them
 *      using ffmpeg.wasm (see `app/lib/ffmpeg-export.ts` for the wasm init).
 *   3. It uploads the resulting blob via the normal chunked upload flow.
 *   4. It calls THIS action to create the new recording row, passing
 *      `sourceRecordingIds` for provenance, the uploaded `videoUrl`, and the
 *      new `durationMs`.
 *
 * If the caller omits `videoUrl`/`durationMs` we create a row in `processing`
 * state — the UI can then upload and finalize via `/api/uploads/:id/complete`.
 *
 * Usage (from the UI after the concat completes):
 *   pnpm action stitch-recordings \
 *     --title="Combined walkthrough" \
 *     --sourceRecordingIds='["rec_a","rec_b"]' \
 *     --videoUrl="/api/video/..." --durationMs=124000
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import { parseEdits, serializeEdits } from "../app/lib/timestamp-mapping.js";

export default defineAction({
  description:
    "Stitch multiple recordings into a new recording. The client-side editor is expected to concat the video files via ffmpeg.wasm and pass in the uploaded videoUrl + durationMs. Returns the new recording id.",
  schema: z.object({
    sourceRecordingIds: z
      .union([z.string(), z.array(z.string())])
      .describe("Ordered list of source recording IDs (or JSON-encoded array)"),
    title: z.string().optional().describe("Title for the stitched recording"),
    visibility: z
      .enum(["private", "org", "public"])
      .optional()
      .describe("Visibility for the new recording (defaults to 'private')"),
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
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

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

    // Load sources so we can copy workspace + validate ownership.
    const sources = await db
      .select()
      .from(schema.recordings)
      .where(
        and(
          inArray(schema.recordings.id, ids),
          eq(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    if (sources.length !== ids.length) {
      throw new Error(
        `Not all source recordings were found (or not owned): asked for ${ids.length}, got ${sources.length}`,
      );
    }

    const byId = new Map(sources.map((s) => [s.id, s]));
    const ordered = ids.map((id) => byId.get(id)!);
    const organizationId = ordered[0].organizationId;

    const totalDuration =
      args.durationMs ??
      ordered.reduce((sum, r) => sum + (r.durationMs || 0), 0);

    // Use the largest dimensions across sources as a sensible default.
    const width =
      args.width ?? Math.max(...ordered.map((r) => r.width || 0), 0);
    const height =
      args.height ?? Math.max(...ordered.map((r) => r.height || 0), 0);

    const id = nanoid();
    const now = new Date().toISOString();

    // Seed editsJson with provenance so the editor/player can link back.
    const edits = parseEdits("{}");
    (edits as any).stitchedFrom = ids;

    await db.insert(schema.recordings).values({
      id,
      organizationId,
      folderId: args.folderId ?? null,
      title: args.title?.trim() || "Stitched recording",
      status: args.videoUrl ? "ready" : "processing",
      uploadProgress: args.videoUrl ? 100 : 0,
      videoUrl: args.videoUrl ?? null,
      videoFormat: "mp4",
      durationMs: totalDuration,
      width,
      height,
      hasAudio: ordered.some((r) => Boolean(r.hasAudio)),
      hasCamera: ordered.some((r) => Boolean(r.hasCamera)),
      editsJson: serializeEdits(edits),
      ownerEmail,
      visibility: args.visibility ?? "private",
      createdAt: now,
      updatedAt: now,
      // Reuse the first source's thumbnail so the new row has something to show immediately.
      thumbnailUrl: ordered[0].thumbnailUrl ?? null,
    } as any);

    await writeAppState("refresh-signal", { ts: Date.now() });
    if (!args.videoUrl) {
      // Tell the UI it needs to upload the stitched video.
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
      status: args.videoUrl ? ("ready" as const) : ("processing" as const),
      durationMs: totalDuration,
      uploadChunkUrlTemplate: args.videoUrl
        ? null
        : `/api/uploads/${id}/chunk?index={index}&total={total}&isFinal={isFinal}`,
    };
  },
});

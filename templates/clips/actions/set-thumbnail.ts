/**
 * Set a recording's thumbnail.
 *
 * Three modes:
 *   1. `upload` — caller passes a base64 data URL (usually from the UI file
 *      picker). We decode and push it through the framework `uploadFile`.
 *   2. `frame` — caller passes a `timeMs`. This stores the time in editsJson
 *      (so the player can show a freeze-frame overlay). The UI is responsible
 *      for also capturing the frame bitmap client-side and calling this action
 *      again in `upload` mode to replace the stored image.
 *   3. `gif` — caller passes a pre-encoded animated GIF data URL (generated
 *      client-side via ffmpeg.wasm). Stored as `animatedThumbnailUrl`.
 *
 * The source-of-truth spec also lives in `editsJson.thumbnail` so the editor
 * UI can round-trip the chosen mode.
 *
 * Usage:
 *   pnpm action set-thumbnail --recordingId=<id> --kind=frame --timeMs=12000
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { parseEdits, serializeEdits } from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { requiresConfiguredVideoStorage } from "../server/lib/video-storage.js";
import { assertNativeRecordingMedia } from "./lib/native-media.js";

const MAX_CAS_ATTEMPTS = 5;
const THUMBNAIL_STORAGE_REQUIRED_REASON =
  "Thumbnail storage is not connected yet. Connect Builder.io or configure S3-compatible storage to save thumbnails.";

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("dataUrl must be base64-encoded data: URL");
  const mime = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime };
}

export default defineAction({
  description:
    "Set a recording's thumbnail. kind='upload' uploads a data URL; kind='frame' stores a time reference; kind='gif' uploads an animated GIF as the animated thumbnail.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    kind: z
      .enum(["upload", "frame", "gif"])
      .describe(
        "Thumbnail mode: upload (image), frame (time reference), gif (animated)",
      ),
    dataUrl: z
      .string()
      .optional()
      .describe("base64 data URL — required for kind=upload and kind=gif"),
    timeMs: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Time in ms to freeze-frame — required for kind=frame"),
    startMs: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Animated thumb start — optional for kind=gif (for round-tripping)",
      ),
    durationMs: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Animated thumb duration — optional for kind=gif (for round-tripping)",
      ),
    filename: z.string().optional(),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId));
    if (!existing) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }
    if (args.kind !== "upload") {
      assertNativeRecordingMedia(existing);
    }

    // Do the (potentially slow) upload side-effect once, up front — it does
    // not depend on the current editsJson, so it must not be repeated on
    // every CAS retry below.
    const basePatch: Record<string, unknown> = {};
    let thumbnailPatch: { kind: "url"; value: string } | undefined;
    let gifPatch: { kind: "gif"; value: string; url: string } | undefined;
    let framePatch: { kind: "frame"; value: string } | undefined;

    if (args.kind === "upload") {
      if (!args.dataUrl) throw new Error("dataUrl is required for kind=upload");
      const { bytes, mime } = decodeDataUrl(args.dataUrl);
      const uploaded = await uploadFile({
        data: bytes,
        mimeType: mime,
        filename:
          args.filename ??
          `thumb-${args.recordingId}.${mime.split("/")[1] ?? "png"}`,
        ownerEmail,
        recordAsset: false,
      });
      if (!uploaded?.url && requiresConfiguredVideoStorage()) {
        throw new Error(THUMBNAIL_STORAGE_REQUIRED_REASON);
      }
      const url = uploaded?.url ?? args.dataUrl; // Local SQL fallback only.
      basePatch.thumbnailUrl = url;
      thumbnailPatch = { kind: "url", value: url };
    } else if (args.kind === "frame") {
      if (typeof args.timeMs !== "number") {
        throw new Error("timeMs is required for kind=frame");
      }
      framePatch = { kind: "frame", value: String(args.timeMs) };
      // thumbnailUrl stays whatever the last captured-frame upload was.
    } else if (args.kind === "gif") {
      if (!args.dataUrl) throw new Error("dataUrl is required for kind=gif");
      const { bytes, mime } = decodeDataUrl(args.dataUrl);
      const uploaded = await uploadFile({
        data: bytes,
        mimeType: mime || "image/gif",
        filename: args.filename ?? `thumb-${args.recordingId}.gif`,
        ownerEmail,
        recordAsset: false,
      });
      if (!uploaded?.url && requiresConfiguredVideoStorage()) {
        throw new Error(THUMBNAIL_STORAGE_REQUIRED_REASON);
      }
      const url = uploaded?.url ?? args.dataUrl; // Local SQL fallback only.
      basePatch.animatedThumbnailUrl = url;
      basePatch.animatedThumbnailEnabled = true;
      gifPatch = {
        kind: "gif",
        url,
        value: JSON.stringify({
          url,
          startMs: args.startMs ?? 0,
          durationMs: args.durationMs ?? 3000,
        }),
      };
    }

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const [current] =
        attempt === 0
          ? [existing]
          : await db
              .select()
              .from(schema.recordings)
              .where(eq(schema.recordings.id, args.recordingId));
      if (!current) {
        throw new Error(`Recording not found: ${args.recordingId}`);
      }

      const previousEditsJson = current.editsJson;
      const edits = parseEdits(previousEditsJson);

      if (thumbnailPatch) edits.thumbnail = thumbnailPatch;
      else if (framePatch) edits.thumbnail = framePatch;
      else if (gifPatch)
        edits.thumbnail = { kind: gifPatch.kind, value: gifPatch.value };

      const patch: Record<string, unknown> = {
        ...basePatch,
        editsJson: serializeEdits(edits),
        updatedAt: new Date().toISOString(),
      };

      const result = await db
        .update(schema.recordings)
        .set(patch)
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            previousEditsJson == null
              ? isNull(schema.recordings.editsJson)
              : eq(schema.recordings.editsJson, previousEditsJson),
          ),
        )
        .returning({ id: schema.recordings.id });

      if (result.length > 0) {
        await writeAppState("refresh-signal", { ts: Date.now() });
        console.log(`Set ${args.kind} thumbnail for ${args.recordingId}`);
        return {
          id: args.recordingId,
          kind: args.kind,
          thumbnailUrl: patch.thumbnailUrl ?? current.thumbnailUrl,
          animatedThumbnailUrl:
            patch.animatedThumbnailUrl ?? current.animatedThumbnailUrl,
          editsJson: edits,
        };
      }
      // Someone else changed editsJson between our read and write — retry
      // against the now-current value. The already-uploaded file stays
      // valid; only the editsJson merge is recomputed.
    }

    throw new Error(
      `Could not set thumbnail on recording ${args.recordingId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
    );
  },
});

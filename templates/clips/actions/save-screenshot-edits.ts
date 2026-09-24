/**
 * Save a screenshot's edits, and burn its redactions in when asked.
 *
 * Redaction works the way it does on a video, in two steps:
 *
 * 1. **Placing.** Redaction boxes are saved as data in `editsJson.overlays`,
 *    in the video editor's own format, and stay movable. Nothing is destroyed
 *    — the unmarked original is kept as the base — so while any are waiting
 *    the screenshot is held back from everyone who cannot edit it, by the same
 *    checks that hold a clip (`server/lib/pending-redactions.ts`).
 * 2. **Burning in.** The client sends `baseDataUrl`: the picture with the
 *    redactions destroyed and no marks. It becomes the new base, the previous
 *    files are deleted, the pending list is cleared — which lifts the hold —
 *    and the title gains the same "(Redacted)" marker a burned clip does. If a
 *    delete fails the action fails: claiming a redaction while the unredacted
 *    original is still fetchable is the one outcome worth refusing.
 *
 * A burn has no undo. Burned regions are recorded (where, never what).
 */

import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { assertAccess } from "@agent-native/core/sharing";
import { isImageRecording } from "@shared/recording-kind.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { parseEdits, serializeEdits } from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { IMAGE_EXTENSION_BY_MIME } from "../server/lib/image-signature.js";
import { deleteStoredMediaUrl } from "../server/lib/recording-media-cleanup.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { STORAGE_SETUP_REQUIRED_REASON } from "../server/lib/video-storage.js";
import { parseBackground } from "../app/lib/screenshot-background.js";
import { otherOverlays, parseRedactions } from "../app/lib/video-redactions.js";
import { redactedTitle } from "./burn-recording-redactions.js";
import { decodeScreenshotDataUrl } from "./lib/screenshot-image.js";

const redactionRect = z.object({
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
  width: z.coerce.number().int().min(1),
  height: z.coerce.number().int().min(1),
});

export const saveScreenshotEditsSchema = z.object({
  recordingId: z.string().describe("Screenshot to update"),
  dataUrl: z
    .string()
    .describe(
      "base64 data: URL of the flattened image, with the redacted areas already destroyed",
    ),
  baseDataUrl: z
    .string()
    .optional()
    .describe(
      "base64 data: URL of the picture with redactions burned in and no marks drawn on. Sending it IS the burn: the original is deleted and every pending redaction is cleared. Omit it to save without destroying anything.",
    ),
  pendingRedactions: z
    .array(z.record(z.string(), z.unknown()))
    .default([])
    .describe(
      "Redactions placed but not burned in, in the video editor's overlay format. While any are stored the screenshot is held from viewers. Ignored when burning.",
    ),
  annotations: z
    .array(z.record(z.string(), z.unknown()))
    .default([])
    .describe(
      "The movable marks (boxes, arrows, text) in source pixels, in draw order. Stored as data so they can be adjusted later; the served image already has them baked in.",
    ),
  redactions: z
    .array(redactionRect)
    .default([])
    .describe(
      "Areas burned in by this save, in source pixels. Only sent with baseDataUrl. Recorded so there is a note of where content was destroyed.",
    ),
  crop: z
    .object({
      x: z.coerce.number().int().min(0),
      y: z.coerce.number().int().min(0),
      width: z.coerce.number().int().min(1),
      height: z.coerce.number().int().min(1),
    })
    .nullable()
    .optional()
    .describe(
      "The part of the base picture that is shown, in base pixels; null for all of it. The flattened image is already cut to it; stored so the crop can be changed later.",
    ),
  background: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe(
      "The background the picture sits on, or null for none. Already painted into the flattened image; stored so it can be changed later.",
    ),
  width: z.coerce.number().int().min(1).describe("Flattened image width"),
  height: z.coerce.number().int().min(1).describe("Flattened image height"),
});

/**
 * The recording's `editsJson` after a save. Pure, so the part of a save that
 * decides what stays hidden can be tested without storage.
 */
export function nextScreenshotEdits(
  editsJson: string | null | undefined,
  input: {
    burning: boolean;
    annotations: unknown[];
    pendingRedactions: unknown[];
    burnedRegions: unknown[];
    /** Left alone when undefined; null removes the crop. */
    crop?: { x: number; y: number; width: number; height: number } | null;
    /** Left alone when undefined; null removes the background. */
    background?: unknown;
  },
) {
  const edits = parseEdits(editsJson) as unknown as Record<string, unknown>;
  if (input.burning) {
    const previous = Array.isArray(edits.redactions) ? edits.redactions : [];
    edits.redactions = [...previous, ...input.burnedRegions];
  }
  // The pending list is replaced wholesale, like the marks. A burn empties
  // it: everything that was waiting is now in the pixels, and emptying it is
  // what lifts the hold.
  edits.overlays = [
    ...otherOverlays(edits.overlays),
    ...(input.burning ? [] : parseRedactions(input.pendingRedactions)),
  ];
  // The movable marks replace the previous set wholesale: the editor sends
  // the full list every time, including ones it moved or removed.
  edits.annotations = input.annotations;
  if (input.crop === null) delete edits.crop;
  else if (input.crop) edits.crop = input.crop;
  if (input.background === null) delete edits.background;
  else if (input.background !== undefined) {
    const background = parseBackground(input.background);
    if (background) edits.background = background;
    else delete edits.background;
  }
  return edits as unknown as ReturnType<typeof parseEdits>;
}

export default defineAction({
  description:
    "Permanently burn a screenshot's edits (blur, boxes, arrows, text) into the stored image: uploads the flattened picture, points the recording at it, and deletes the previous file. Cannot be undone.",
  // UI-only: the flattening happens on a canvas in the browser.
  agentTool: false,
  schema: saveScreenshotEditsSchema,
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
    if (!isImageRecording(existing)) {
      throw new Error("Only screenshots can be edited this way.");
    }

    // A pending redaction the stored form would drop — too small, or outside
    // the picture — would lift the hold while the served copy still shows it
    // drawn in, and vanish from the next edit. Refuse rather than drop it.
    if (
      !args.baseDataUrl &&
      parseRedactions(args.pendingRedactions).length !== args.pendingRedactions.length
    ) {
      throw new Error(
        "A redaction box could not be saved. Make it a little bigger, or keep it inside the picture, and save again.",
      );
    }

    const { bytes, mimeType } = decodeScreenshotDataUrl(
      args.dataUrl,
      "The edited screenshot",
    );

    const previousUrl = existing.imageUrl ?? existing.thumbnailUrl ?? null;

    // Same filename as the original, which keeps the stored object inside
    // this recording's own folder — the scoping the media routes check before
    // they will serve it. The provider stamps every upload, so this is still a
    // new object at a new URL, and no cache can hand back the old bytes.
    const uploaded = await uploadFile({
      data: bytes,
      mimeType,
      filename: `screenshot-${args.recordingId}${IMAGE_EXTENSION_BY_MIME[mimeType]}`,
      ownerEmail,
      recordAsset: false,
    });
    if (!uploaded?.url) {
      throw new Error(STORAGE_SETUP_REQUIRED_REASON);
    }

    // The base is only re-uploaded when a blur was added, because that is the
    // only edit that changes the pixels underneath the marks.
    let baseUrl = existing.baseImageUrl ?? null;
    let previousBaseUrl: string | null = null;
    if (args.baseDataUrl) {
      const base = decodeScreenshotDataUrl(
        args.baseDataUrl,
        "The redacted base image",
      );
      const uploadedBase = await uploadFile({
        data: base.bytes,
        mimeType: base.mimeType,
        filename: `screenshot-${args.recordingId}${IMAGE_EXTENSION_BY_MIME[base.mimeType]}`,
        ownerEmail,
        recordAsset: false,
      });
      if (!uploadedBase?.url) {
        throw new Error(STORAGE_SETUP_REQUIRED_REASON);
      }
      previousBaseUrl = existing.baseImageUrl ?? previousUrl;
      baseUrl = uploadedBase.url;
    } else if (!baseUrl) {
      // First edit and nothing was blurred: the picture being replaced is
      // itself the un-marked base, so it is kept rather than deleted — without
      // it the next edit session would have to start from the flattened copy
      // and the marks would be stuck in the image for good.
      baseUrl = previousUrl;
    }

    // Point the recording at the redacted file BEFORE deleting the original,
    // so a failure here never leaves the row referencing a file that is gone.
    const now = new Date().toISOString();
    const burning = Boolean(args.baseDataUrl);
    const edits = nextScreenshotEdits(existing.editsJson, {
      burning,
      annotations: args.annotations,
      pendingRedactions: args.pendingRedactions,
      burnedRegions: args.redactions,
      crop: args.crop,
      background: args.background,
    });

    await db
      .update(schema.recordings)
      .set({
        imageUrl: uploaded.url,
        thumbnailUrl: uploaded.url,
        baseImageUrl: baseUrl,
        thumbnailStatus: "generated",
        width: args.width,
        height: args.height,
        videoSizeBytes: bytes.byteLength,
        editsJson: serializeEdits(edits),
        ...(burning
          ? { title: redactedTitle(existing.title) ?? existing.title }
          : {}),
        updatedAt: now,
        mediaUpdatedAt: now,
      })
      .where(eq(schema.recordings.id, args.recordingId));

    // Now destroy the original. Failing here is worth surfacing loudly: the
    // recording already shows the redacted image, but the unredacted file is
    // still sitting in storage and the owner needs to know.
    let originalDeleted = true;
    const staleUrls = [previousUrl, previousBaseUrl].filter(
      (url): url is string =>
        Boolean(url) && url !== uploaded.url && url !== baseUrl,
    );
    for (const staleUrl of staleUrls) {
      try {
        originalDeleted = (await deleteStoredMediaUrl(staleUrl)) && originalDeleted;
      } catch (err) {
        originalDeleted = false;
        console.warn(
          `[save-screenshot-edits] could not delete a stale file for ${args.recordingId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(
      `Saved screenshot edits for ${args.recordingId} (${burning ? `burned ${args.redactions.length} redaction(s)` : `${parseRedactions(args.pendingRedactions).length} redaction(s) pending`}, previous file deleted: ${originalDeleted})`,
    );

    // Only a burn has something to hide in the files it replaces: the
    // unredacted original. An ordinary save only replaces the last flattened
    // copy, whose redactions were drawn in and which nothing points at any
    // more, so a leftover there is tidying, not exposure — and failing the save
    // after the row has already moved on left the editor open over a saved
    // edit, telling the owner to delete a screenshot with nothing to hide.
    if (!originalDeleted && burning) {
      throw new Error(
        "The redactions were burned in, but the unredacted original could not be deleted from storage. Treat what you redacted as still exposed and delete the screenshot.",
      );
    }

    return {
      id: args.recordingId,
      imageUrl: uploaded.url,
      redactions: args.redactions.length,
      staleFileLeft: !originalDeleted,
    };
  },
});

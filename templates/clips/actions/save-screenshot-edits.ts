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
 * Between those writes the row carries a burn-in-progress marker listing the
 * files still to delete (`server/lib/pending-redactions.ts`). It holds the
 * screenshot on its own, so the hold never depends on the boxes having been
 * saved as pending first, and every other save is refused until it clears.
 *
 * A burn has no undo. Burned regions are recorded (where, never what).
 */

import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { assertAccess } from "@agent-native/core/sharing";
import { isImageRecording } from "@shared/recording-kind";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { parseBackground } from "../app/lib/screenshot-background.js";
import { parseEdits, serializeEdits } from "../app/lib/timestamp-mapping.js";
import { otherOverlays, parseRedactions } from "../app/lib/video-redactions.js";
import { getDb, schema } from "../server/db/index.js";
import { IMAGE_EXTENSION_BY_MIME } from "../server/lib/image-signature.js";
import {
  BURN_IN_PROGRESS_KEY,
  burnInProgressUrls,
} from "../server/lib/pending-redactions.js";
import { deleteStoredMediaUrl } from "../server/lib/recording-media-cleanup.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import {
  isReadableEditsJson,
  UNRECLAIMED_URLS_KEY,
  unreclaimedUrls,
} from "../server/lib/screenshot-edits.js";
import { STORAGE_SETUP_REQUIRED_REASON } from "../server/lib/video-storage.js";
import { redactedTitle } from "./burn-recording-redactions.js";
import {
  decodeScreenshotDataUrl,
  MAX_SCREENSHOT_BYTES,
} from "./lib/screenshot-image.js";

const redactionRect = z.object({
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
  width: z.coerce.number().int().min(1),
  height: z.coerce.number().int().min(1),
});

export const saveScreenshotEditsSchema = z.object({
  recordingId: z.string().describe("Screenshot to update"),
  mediaRevision: z
    .string()
    .describe(
      "The recording's mediaUpdatedAt when the editor loaded its picture. A save from an editor that loaded an older picture is refused, so it cannot put back pixels a burn destroyed.",
    ),
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

/**
 * The edits a burn finishes with, once its files are gone. Carried in the
 * marker so a later save can finish an interrupted burn as it would have
 * finished, rather than leave marks and crop out of step with the burned
 * picture.
 */
function withBurnMarker(
  editsJson: string | null,
  staleUrls: string[],
  resultEditsJson: string,
) {
  const edits = parseEdits(editsJson) as unknown as Record<string, unknown>;
  edits[BURN_IN_PROGRESS_KEY] = { staleUrls, editsJson: resultEditsJson };
  return serializeEdits(edits as unknown as ReturnType<typeof parseEdits>);
}

/** The edits an interrupted burn was going to finish with. */
function burnResultOf(heldEditsJson: string): string {
  const edits = parseEdits(heldEditsJson) as unknown as Record<string, unknown>;
  const marker = edits[BURN_IN_PROGRESS_KEY] as
    | { editsJson?: unknown }
    | undefined;
  if (typeof marker?.editsJson === "string") return marker.editsJson;
  delete edits[BURN_IN_PROGRESS_KEY];
  return serializeEdits(edits as unknown as ReturnType<typeof parseEdits>);
}

/** Deletes each URL; returns the ones that are still in storage. */
async function deleteAll(recordingId: string, urls: string[]) {
  const left: string[] = [];
  for (const url of urls) {
    try {
      if (!(await deleteStoredMediaUrl(url))) left.push(url);
    } catch (err) {
      left.push(url);
      console.warn(
        `[save-screenshot-edits] could not delete a stale file for ${recordingId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return left;
}

const CHANGED_ELSEWHERE =
  "This screenshot was changed somewhere else while you were editing. Nothing was saved — reload it and try again.";

const FINISHED_EARLIER_BURN =
  "An earlier redaction on this screenshot has now finished and its original is deleted. Reload it to see the result, then make any further changes.";

const ORIGINAL_NOT_DELETED =
  "The redactions were burned in, but the unredacted original could not be deleted from storage. The screenshot is held back from viewers until it is — reload it and save again to retry. Until then, treat what you redacted as still exposed.";

export default defineAction({
  description:
    "Permanently burn a screenshot's edits (blur, boxes, arrows, text) into the stored image: uploads the flattened picture, points the recording at it, and deletes the previous file. Cannot be undone.",
  // UI-only: the flattening happens on a canvas in the browser.
  agentTool: false,
  // Base64 two pictures (the served one and the base), plus room for the marks. The framework checks
  // this against Content-Length before reading; the decode below still caps
  // each picture for a body sent without one.
  maxBodyBytes: Math.ceil((2 * 4 * MAX_SCREENSHOT_BYTES) / 3) + 1024 * 1024,
  schema: saveScreenshotEditsSchema,
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    /**
     * Swap the marker for the burn's edits and mark the title redacted. The
     * title is read here, not taken from when the burn began: a rename during
     * the deletes changes only the title, which the edits predicate cannot
     * see, so it is pinned too and a lost race re-reads it. Access was
     * asserted above; asking again after the original is deleted could only
     * turn a finished burn into a reported failure.
     */
    const releaseBurn = async (heldEditsJson: string): Promise<boolean> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const [row] = await db
          .select({
            title: schema.recordings.title,
            editsJson: schema.recordings.editsJson,
          })
          .from(schema.recordings)
          .where(eq(schema.recordings.id, args.recordingId));
        if (!row || row.editsJson !== heldEditsJson) return false;
        const released = await db
          .update(schema.recordings)
          .set({
            editsJson: burnResultOf(heldEditsJson),
            title: redactedTitle(row.title) ?? row.title,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(schema.recordings.id, args.recordingId),
              eq(schema.recordings.editsJson, heldEditsJson),
              eq(schema.recordings.title, row.title),
            ),
          )
          .returning({ id: schema.recordings.id });
        if (released.length) return true;
      }
      return false;
    };

    let [existing] = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId));
    if (!existing) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }
    if (!isImageRecording(existing)) {
      throw new Error("Only screenshots can be edited this way.");
    }
    // The editor was handed no marks for edits it could not read, and a save
    // replaces the mark list wholesale, so going on would erase them.
    if (!isReadableEditsJson(existing.editsJson)) {
      throw new Error(
        "This screenshot's saved edits could not be read, so saving would lose them. Nothing was saved.",
      );
    }

    // A burn that could not delete the original left its marker, and the
    // hold, on the row. Finish that first: no save may lift the hold while
    // the unredacted file is still in storage.
    let finishedEarlierBurn = false;
    const leftover = burnInProgressUrls(existing.editsJson);
    if (leftover) {
      const left = await deleteAll(args.recordingId, leftover);
      if (left.length) throw new Error(ORIGINAL_NOT_DELETED);
      if (!(await releaseBurn(existing.editsJson!))) {
        throw new Error(
          "This screenshot is still finishing a redaction. Reload it and try again.",
        );
      }
      await writeAppState("refresh-signal", { ts: Date.now() });
      const [finished] = await db
        .select()
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId));
      if (!finished) {
        throw new Error(`Recording not found: ${args.recordingId}`);
      }
      existing = finished;
      finishedEarlierBurn = true;
    }

    // The CAS below only compares against the row as read here, which a
    // stale editor would read too. Its own revision is what gives it away.
    if (existing.mediaUpdatedAt !== args.mediaRevision) {
      throw new Error(
        finishedEarlierBurn ? FINISHED_EARLIER_BURN : CHANGED_ELSEWHERE,
      );
    }

    // A pending redaction the stored form would drop — too small, or outside
    // the picture — would lift the hold while the served copy still shows it
    // drawn in, and vanish from the next edit. Refuse rather than drop it.
    if (
      !args.baseDataUrl &&
      parseRedactions(args.pendingRedactions).length !==
        args.pendingRedactions.length
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
      filename: `${args.recordingId}${IMAGE_EXTENSION_BY_MIME[mimeType]}`,
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
        filename: `${args.recordingId}${IMAGE_EXTENSION_BY_MIME[base.mimeType]}`,
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
    // Carried separately below: the edits a burn finishes with have none.
    delete (edits as unknown as Record<string, unknown>)[UNRECLAIMED_URLS_KEY];
    const newUrls = [uploaded.url, baseUrl].filter(
      (url): url is string =>
        Boolean(url) && url !== previousUrl && url !== existing.baseImageUrl,
    );

    // Every write is pinned to the row as it was read. Two editor tabs can
    // both be saving; without this a save started before a burn could land
    // after it and put the unredacted picture back, with the hold cleared.
    const unchanged = and(
      eq(schema.recordings.id, args.recordingId),
      eq(schema.recordings.mediaUpdatedAt, existing.mediaUpdatedAt),
      existing.editsJson == null
        ? isNull(schema.recordings.editsJson)
        : eq(schema.recordings.editsJson, existing.editsJson),
      existing.imageUrl == null
        ? isNull(schema.recordings.imageUrl)
        : eq(schema.recordings.imageUrl, existing.imageUrl),
      existing.baseImageUrl == null
        ? isNull(schema.recordings.baseImageUrl)
        : eq(schema.recordings.baseImageUrl, existing.baseImageUrl),
    );

    // A first burn with no separate base yet has the original under both
    // names; deleting it twice would read the second 404 as a failure.
    // Copies an earlier save could not delete go too: they were made before
    // anything now redacted was covered.
    const staleUrls = [
      ...new Set(
        [
          previousUrl,
          previousBaseUrl,
          ...unreclaimedUrls(existing.editsJson),
        ].filter(
          (url): url is string =>
            Boolean(url) && url !== uploaded.url && url !== baseUrl,
        ),
      ),
    ];

    // Point the recording at the new files BEFORE deleting the old ones, so a
    // failure never leaves the row referencing a file that is gone. A burn
    // writes its marker instead of its edits: the hold has to be on before
    // the original is deleted, and must not lift until it is gone. The edits
    // wait for the second write below, the way the video burn does it.
    // An ordinary save lists what it is about to delete before deleting it,
    // and keeps whatever it could not, so no copy is ever left untracked.
    const withUnreclaimed = (urls: string[]) =>
      serializeEdits(
        (urls.length
          ? { ...edits, [UNRECLAIMED_URLS_KEY]: urls }
          : edits) as unknown as ReturnType<typeof parseEdits>,
      );
    const burnResult = serializeEdits(edits);
    const writtenEditsJson = burning
      ? withBurnMarker(existing.editsJson, staleUrls, burnResult)
      : withUnreclaimed(staleUrls);
    const heldEditsJson = burning ? writtenEditsJson : null;
    const updated = await db
      .update(schema.recordings)
      .set({
        imageUrl: uploaded.url,
        thumbnailUrl: uploaded.url,
        baseImageUrl: baseUrl,
        thumbnailStatus: "generated",
        width: args.width,
        height: args.height,
        videoSizeBytes: bytes.byteLength,
        editsJson: writtenEditsJson,
        updatedAt: now,
        mediaUpdatedAt: now,
      })
      .where(unchanged)
      .returning({ id: schema.recordings.id });

    if (!updated.length) {
      // Someone else saved first. Nothing here was published, so the new
      // files are only orphans.
      for (const url of newUrls) {
        try {
          await deleteStoredMediaUrl(url);
        } catch (err) {
          // Costs storage, not correctness; the throw below is what the
          // caller needs to see.
          console.warn(
            `[save-screenshot-edits] could not delete an orphaned upload for ${args.recordingId}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      throw new Error(CHANGED_ELSEWHERE);
    }

    // Now destroy what was replaced. For a burn that includes the unredacted
    // original, and the hold stays on until it is gone.
    const left = await deleteAll(args.recordingId, staleUrls);
    const originalDeleted = left.length === 0;

    if (!burning && staleUrls.length && left.length !== staleUrls.length) {
      // Pinned to what was just written; a save that landed since carried
      // this list forward itself.
      await db
        .update(schema.recordings)
        .set({ editsJson: withUnreclaimed(left) })
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            eq(schema.recordings.editsJson, writtenEditsJson),
          ),
        );
    }

    if (burning && !originalDeleted) {
      // The marker keeps the screenshot held; narrowed to what is left, so
      // the next save's retry does not trip over files already gone.
      await db
        .update(schema.recordings)
        .set({
          editsJson: withBurnMarker(existing.editsJson, left, burnResult),
        })
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            eq(schema.recordings.editsJson, heldEditsJson!),
          ),
        );
      await writeAppState("refresh-signal", { ts: Date.now() });
      throw new Error(ORIGINAL_NOT_DELETED);
    }

    if (burning) {
      // Only now: the original is gone, so clearing the marker and the
      // pending list can no longer publish anything they covered. Every other
      // save is refused while the marker is on, so the row is as written.
      if (!(await releaseBurn(heldEditsJson!))) {
        // Something outside the editor rewrote the edits. Nothing is exposed
        // — the pixels are burned and the original deleted — and the next
        // save clears the marker, whose files are already gone.
        console.warn(
          `[save-screenshot-edits] burned ${args.recordingId}, but its edits changed meanwhile, so it stays held until the next save`,
        );
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(
      `Saved screenshot edits for ${args.recordingId} (${burning ? `burned ${args.redactions.length} redaction(s)` : `${parseRedactions(args.pendingRedactions).length} redaction(s) pending`}, previous file deleted: ${originalDeleted})`,
    );

    // An ordinary save's leftovers stay listed on the row: the next save,
    // the burn and permanent delete all retry them.
    return {
      id: args.recordingId,
      imageUrl: uploaded.url,
      redactions: args.redactions.length,
      staleFileLeft: !originalDeleted,
    };
  },
});

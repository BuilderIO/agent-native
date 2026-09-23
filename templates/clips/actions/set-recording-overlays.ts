/**
 * Replace the overlay list on a recording — the redaction boxes, and whatever
 * overlay kinds come later.
 *
 * Nothing here hides anything. Overlays are metadata: the stored video still
 * has every pixel, and anyone with the link can still see what a box is drawn
 * over. `burn-recording-redactions` is what makes a redaction real. This
 * action exists so the boxes can be placed, moved and argued over first,
 * because the burn cannot be undone.
 *
 * Usage:
 *   pnpm action set-recording-overlays --recordingId=<id> \
 *     --overlays='[{"id":"redact-1","kind":"redact","style":"solid","startMs":1000,"endMs":4000,"keys":[{"atMs":1000,"x":0.1,"y":0.2,"w":0.3,"h":0.1}]}]'
 */

import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { parseEdits, serializeEdits } from "../app/lib/timestamp-mapping.js";
import { otherOverlays, parseRedactions } from "../app/lib/video-redactions.js";
import { getDb, schema } from "../server/db/index.js";
import { assertNativeRecordingMedia } from "./lib/native-media.js";

const MAX_CAS_ATTEMPTS = 5;
/** A guard against a runaway client, not a design limit. */
const MAX_OVERLAYS = 200;

export default defineAction({
  description:
    "Replace the overlay list on a recording. Today that means redaction boxes: {id,kind:'redact',style:'solid',startMs,endMs,keys:[{atMs,x,y,w,h}]} with coordinates normalized 0-1 and one key per position the box moves through. This only records where the boxes are — the video still shows everything until `burn-recording-redactions` renders them in.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    overlays: z
      .union([z.string(), z.array(z.record(z.string(), z.unknown()))])
      .describe(
        "The complete overlay list — either a JSON-encoded string (CLI) or an array (agent).",
      ),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    let incoming: unknown[];
    if (typeof args.overlays === "string") {
      try {
        const parsed = JSON.parse(args.overlays);
        if (!Array.isArray(parsed)) throw new Error("expected an array");
        incoming = parsed;
      } catch (e: any) {
        throw new Error(`Invalid --overlays JSON: ${e.message ?? e}`);
      }
    } else {
      incoming = args.overlays;
    }

    if (incoming.length > MAX_OVERLAYS) {
      throw new Error(
        `Too many overlays: ${incoming.length} (limit ${MAX_OVERLAYS}).`,
      );
    }

    // Redactions are normalized and anything malformed is dropped rather than
    // stored: a box the burn cannot read is a box the user thinks is covering
    // something. Overlay kinds this version does not know about pass through.
    const redactions = parseRedactions(incoming);
    const rejected =
      incoming.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).kind === "redact",
      ).length - redactions.length;
    if (rejected > 0) {
      throw new Error(
        `${rejected} redaction(s) were not usable — each one needs a time range and at least one box inside the frame.`,
      );
    }
    const overlays = [...redactions, ...otherOverlays(incoming)];

    const db = getDb();

    // What the overlay list looked like on the first read. A retry is only
    // safe while this has not moved: the caller sends a whole list, so it is
    // saying "these are the boxes" against the state it last saw. If someone
    // else has added or moved one in the meantime, writing this list again
    // would delete their box — and deleting a box lifts the hold on pixels
    // that are still in the file.
    let baseOverlays: string | null = null;

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const [existing] = await db
        .select()
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId));
      if (!existing) {
        throw new Error(`Recording not found: ${args.recordingId}`);
      }
      assertNativeRecordingMedia(existing);

      const previousEditsJson = existing.editsJson;
      const previousOverlays = JSON.stringify(
        parseEdits(previousEditsJson).overlays ?? [],
      );
      if (baseOverlays === null) {
        baseOverlays = previousOverlays;
      } else if (previousOverlays !== baseOverlays) {
        // A conflict caused by a trim being saved at the same moment is
        // harmless and retried above. This one is not: refuse, and let the
        // editor reload rather than quietly undo someone's redaction.
        throw new Error(
          "The redactions on this recording changed while this was saving. Reload the editor and make the change again.",
        );
      }
      const next = { ...parseEdits(previousEditsJson), overlays };

      const result = await db
        .update(schema.recordings)
        .set({
          editsJson: serializeEdits(next),
          updatedAt: new Date().toISOString(),
        })
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
        console.log(
          `Set overlays on ${args.recordingId}: ${redactions.length} redaction(s) — not burned in yet`,
        );
        return {
          id: args.recordingId,
          redactions: redactions.length,
          burned: false,
        };
      }
      // Someone else changed editsJson between our read and write — retry.
    }

    throw new Error(
      `Could not set overlays on recording ${args.recordingId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
    );
  },
});

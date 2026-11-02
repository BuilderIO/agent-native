import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  EXPECTED_REVISION_DESCRIPTION,
  isSameRecord,
  saveIfCurrent,
} from "@agent-native/core/save-conflict/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  identifyTrims,
  parseEdits,
  serializeEdits,
  trimsRevisionOf,
  type TrimRange,
} from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { assertRecordingNotExpired } from "../server/lib/recording-read-access.js";
import { assertNativeRecordingMedia } from "./lib/native-media.js";

const MAX_TRIMS = 2_000;

const TrimSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  startMs: z.coerce.number().finite().min(0),
  endMs: z.coerce.number().finite().min(0),
  excluded: z.coerce.boolean(),
});

export default defineAction({
  description:
    "Replace the whole trim list on a recording. Each entry is {id?,startMs,endMs,excluded}: excluded ranges are skipped during playback, zero-width non-excluded entries are split markers. Blurs and the thumbnail spec are preserved.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    expectedRevision: z
      .string()
      .optional()
      .describe(
        `${EXPECTED_REVISION_DESCRIPTION} Required, because this replaces the whole list: read it as recording.trimsRevision from get-recording-player-data.`,
      ),
    trims: z
      .union([z.string(), z.array(TrimSchema)])
      .describe(
        "The complete trim list — either a JSON-encoded string (CLI) or an array (agent).",
      ),
  }),
  run: async (args) => {
    assertRecordingNotExpired(
      await assertAccess("recording", args.recordingId, "editor"),
    );

    let incoming: Array<z.infer<typeof TrimSchema>>;
    if (typeof args.trims === "string") {
      try {
        incoming = z.array(TrimSchema).parse(JSON.parse(args.trims));
      } catch (e: any) {
        throw new Error(`Invalid --trims JSON: ${e.message ?? e}`);
      }
    } else {
      incoming = args.trims;
    }

    if (incoming.length > MAX_TRIMS) {
      throw new Error(
        `Too many trims: ${incoming.length} (limit ${MAX_TRIMS}).`,
      );
    }

    incoming = incoming.map((t) => ({
      ...t,
      startMs: Math.round(t.startMs),
      endMs: Math.round(t.endMs),
    }));

    const invalid = incoming.find((t) => t.endMs < t.startMs);
    if (invalid) {
      throw new Error(
        `Trim ends before it starts: ${invalid.startMs}–${invalid.endMs} ms`,
      );
    }

    const trims: TrimRange[] = identifyTrims(incoming as TrimRange[]);
    const seen = new Set<string>();
    for (const trim of trims) {
      if (trim.id && seen.has(trim.id)) {
        throw new Error(`Duplicate trim id: ${trim.id}`);
      }
      if (trim.id) seen.add(trim.id);
    }

    const db = getDb();

    const { outcome, current } = await saveIfCurrent({
      record: "clip_trims",
      expectedRevision: args.expectedRevision,
      requireRevision: true,
      read: async () => {
        const rows = await db
          .select()
          .from(schema.recordings)
          .where(eq(schema.recordings.id, args.recordingId));
        const existing = rows.shift();
        if (!existing) {
          fail(`Recording not found: ${args.recordingId}`, {
            errorCode: "recording_not_found",
            statusCode: 404,
          });
        }
        assertNativeRecordingMedia(existing);
        const edits = parseEdits(existing.editsJson);
        return {
          value: edits.trims,
          revision: trimsRevisionOf(existing.editsJson),
          edits,
          previousEditsJson: existing.editsJson,
        };
      },
      isSameSave: (currentTrims) => isSameRecord(currentTrims, trims),
      write: ({ edits, previousEditsJson }) =>
        db
          .update(schema.recordings)
          .set({
            editsJson: serializeEdits({ ...edits, trims }),
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(schema.recordings.id, args.recordingId),
              eq(schema.recordings.editsJson, previousEditsJson),
            ),
          )
          .returning({ id: schema.recordings.id }),
    });

    const next = { ...current.edits, trims };
    const cuts = trims.filter((t) => t.excluded).length;
    if (outcome === "written") {
      await writeAppState("refresh-signal", { ts: Date.now() });
      console.log(
        `Set trims on ${args.recordingId}: ${cuts} cut(s), ${trims.length - cuts} split marker(s)`,
      );
    }
    return {
      id: args.recordingId,
      editsJson: next,
      trimCount: cuts,
      revision: trimsRevisionOf(serializeEdits(next)),
    };
  },
});

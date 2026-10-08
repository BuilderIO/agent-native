import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  identifyTrims,
  parseEdits,
  serializeEdits,
  type TrimRange,
} from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { assertNativeRecordingMedia } from "./lib/native-media.js";

const MAX_CAS_ATTEMPTS = 5;
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
    trims: z
      .union([z.string(), z.array(TrimSchema)])
      .describe(
        "The complete trim list — either a JSON-encoded string (CLI) or an array (agent).",
      ),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

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
      const next = { ...parseEdits(previousEditsJson), trims };

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
        const cuts = trims.filter((t) => t.excluded).length;
        console.log(
          `Set trims on ${args.recordingId}: ${cuts} cut(s), ${trims.length - cuts} split marker(s)`,
        );
        return { id: args.recordingId, editsJson: next, trimCount: cuts };
      }
      // Someone else changed editsJson between our read and write — retry
      // against the now-current value.
    }

    throw new Error(
      `Could not set trims on recording ${args.recordingId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
    );
  },
});

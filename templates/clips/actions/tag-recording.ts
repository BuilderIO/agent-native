import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  applyToRecordings,
  recordingBatchSchema,
  recordingIdsField,
  refreshAfterBatch,
  requestedRecordingIds,
} from "../server/lib/recording-batch.js";
import { assertRecordingNotExpired } from "../server/lib/recording-read-access.js";
import { nanoid } from "../server/lib/recordings.js";

async function tagOne(recordingId: string, tag: string, op: "add" | "remove") {
  assertRecordingNotExpired(
    await assertAccess("recording", recordingId, "editor"),
  );
  const db = getDb();

  const tagged = and(
    eq(schema.recordingTags.recordingId, recordingId),
    eq(schema.recordingTags.tag, tag),
  );
  // The readback shares the write's transaction, so if it fails the write is
  // undone too and a batch can truthfully report the recording as skipped.
  return db.transaction(async (tx) => {
    // A permanent delete locks the recording too, so it runs wholly before
    // this (and the recording is gone here) or after (and removes the new
    // tag with the rest), never leaving a tag on a deleted recording.
    const rows = await tx
      .select({ organizationId: schema.recordings.organizationId })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, recordingId))
      .for("update");
    if (!rows.length) {
      fail(`Recording not found: ${recordingId}`, {
        errorCode: "recording_not_found",
        statusCode: 404,
      });
    }
    let changed: boolean;
    if (op === "add") {
      const existing = await tx
        .select({ id: schema.recordingTags.id })
        .from(schema.recordingTags)
        .where(tagged);
      changed = !existing.length;
      if (changed) {
        await tx.insert(schema.recordingTags).values({
          id: nanoid(),
          recordingId,
          organizationId: rows[0].organizationId,
          tag,
        });
      }
    } else {
      const removed = await tx
        .delete(schema.recordingTags)
        .where(tagged)
        .returning({ id: schema.recordingTags.id });
      changed = removed.length > 0;
    }

    const tags = await tx
      .select({ tag: schema.recordingTags.tag })
      .from(schema.recordingTags)
      .where(eq(schema.recordingTags.recordingId, recordingId));

    return {
      status: changed ? ("changed" as const) : ("unchanged" as const),
      tags: tags.map((t) => t.tag),
    };
  });
}

export default defineAction({
  description:
    "Add or remove a tag on one or more recordings. Use op='add' or op='remove'.",
  schema: z
    .object({
      recordingId: z.string().min(1).optional().describe("Recording id"),
      recordingIds: recordingIdsField("tag or untag").optional(),
      tag: z.string().min(1).max(64).describe("Tag text"),
      op: z.enum(["add", "remove"]).default("add").describe("Add or remove"),
    })
    .refine((args) => Boolean(args.recordingId) || Boolean(args.recordingIds), {
      message: "Provide recordingId or recordingIds.",
    }),
  outputSchema: z.union([
    z.object({ id: z.string(), tags: z.array(z.string()) }),
    recordingBatchSchema({ tags: z.array(z.string()) }),
  ]),
  run: async (args) => {
    const ids = requestedRecordingIds(args.recordingId, args.recordingIds);
    if (args.recordingIds) {
      const batch = await applyToRecordings(ids, (id) =>
        tagOne(id, args.tag, args.op),
      );
      await refreshAfterBatch(batch.changed);
      return batch;
    }

    const id = ids[0];
    const { tags } = await tagOne(id, args.tag, args.op);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id, tags };
  },
});

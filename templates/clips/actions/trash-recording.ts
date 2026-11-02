import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, ne } from "drizzle-orm";
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

async function trashOne(id: string, skipIfReady: boolean) {
  assertRecordingNotExpired(await assertAccess("recording", id, "editor"));
  const db = getDb();
  const currentRow = () =>
    db
      .select({
        status: schema.recordings.status,
        trashedAt: schema.recordings.trashedAt,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, id));
  const notFound = () =>
    fail(`Recording not found: ${id}`, {
      errorCode: "recording_not_found",
      statusCode: 404,
    });

  const before = await currentRow();
  if (!before.length) notFound();
  if (before[0].trashedAt) {
    return {
      status: "unchanged" as const,
      trashedAt: before[0].trashedAt,
      // Callers such as abandon-recording-start read skipped to tell a
      // finished upload from a discarded one, already in trash or not.
      skipped: skipIfReady && before[0].status === "ready",
    };
  }

  const now = new Date().toISOString();
  const updated = await db
    .update(schema.recordings)
    .set({ trashedAt: now, updatedAt: now })
    .where(
      skipIfReady
        ? and(
            eq(schema.recordings.id, id),
            ne(schema.recordings.status, "ready"),
          )
        : eq(schema.recordings.id, id),
    )
    .returning({ trashedAt: schema.recordings.trashedAt });
  if (updated.length) {
    return {
      status: "changed" as const,
      trashedAt: updated[0].trashedAt,
      skipped: false,
    };
  }

  // Nothing was written: the upload finished first (with skipIfReady), or
  // the recording went away.
  const after = await currentRow();
  if (!after.length) notFound();
  return {
    status: "unchanged" as const,
    trashedAt: after[0].trashedAt,
    skipped: skipIfReady && after[0].status === "ready",
  };
}

const trashedFields = {
  trashedAt: z.string().nullable(),
  skipped: z.boolean(),
};

export default defineAction({
  description:
    "Move one or more recordings to trash. Soft-delete — use restore-recording to undo, or delete-recording-permanent to remove forever.",
  schema: z
    .object({
      id: z.string().min(1).optional().describe("Recording ID"),
      ids: recordingIdsField("trash").optional(),
      skipIfReady: z
        .boolean()
        .optional()
        .describe(
          "When true, don't trash a recording whose upload already finished (status is 'ready') — used to close a cancel-vs-finalize race atomically.",
        ),
    })
    .refine((args) => Boolean(args.id) || Boolean(args.ids), {
      message: "Provide id or ids.",
    }),
  outputSchema: z.union([
    z.object({ id: z.string(), ...trashedFields }),
    recordingBatchSchema(trashedFields),
  ]),
  run: async (args) => {
    const ids = requestedRecordingIds(args.id, args.ids);
    const skipIfReady = Boolean(args.skipIfReady);
    if (args.ids) {
      const batch = await applyToRecordings(ids, async (id) => {
        const trashed = await trashOne(id, skipIfReady);
        // skipIfReady left a finished upload in the library, which isn't the
        // same as a recording already in trash.
        if (trashed.skipped && !trashed.trashedAt) {
          fail("Its upload already finished, so it stays in the library.", {
            errorCode: "recording_ready",
            statusCode: 409,
          });
        }
        return trashed;
      });
      await refreshAfterBatch(batch.changed);
      return batch;
    }

    const id = ids[0];
    const { trashedAt, skipped } = await trashOne(id, skipIfReady);
    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(
      skipped
        ? `Skipped trashing recording ${id} — already ready`
        : `Trashed recording ${id}`,
    );
    return { id, trashedAt, skipped };
  },
});

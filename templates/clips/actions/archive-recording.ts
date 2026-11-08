import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
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

async function archiveOne(id: string) {
  assertRecordingNotExpired(await assertAccess("recording", id, "editor"));
  const db = getDb();
  const currentRow = () =>
    db
      .select({ archivedAt: schema.recordings.archivedAt })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, id));
  const notFound = () =>
    fail(`Recording not found: ${id}`, {
      errorCode: "recording_not_found",
      statusCode: 404,
    });

  const rows = await currentRow();
  if (!rows.length) notFound();
  const { archivedAt } = rows[0];
  if (archivedAt) return { status: "unchanged" as const, archivedAt };

  const now = new Date().toISOString();
  // Only a row that is still unarchived is written, so a recording archived
  // or deleted since the read above isn't reported as archived by this call.
  const updated = await db
    .update(schema.recordings)
    .set({ archivedAt: now, updatedAt: now })
    .where(
      and(eq(schema.recordings.id, id), isNull(schema.recordings.archivedAt)),
    )
    .returning({ id: schema.recordings.id });
  if (updated.length) return { status: "changed" as const, archivedAt: now };

  const after = await currentRow();
  if (!after.length) notFound();
  const archivedSince = after[0].archivedAt;
  if (archivedSince) {
    return { status: "unchanged" as const, archivedAt: archivedSince };
  }
  fail(`Recording ${id} changed while it was being archived; try again.`, {
    errorCode: "recording_conflict",
    statusCode: 409,
  });
}

export default defineAction({
  description:
    "Archive one or more recordings. Hides them from the main library but keeps all data intact. Use restore-recording to undo.",
  schema: z
    .object({
      id: z.string().min(1).optional().describe("Recording ID"),
      ids: recordingIdsField("archive").optional(),
    })
    .refine((args) => Boolean(args.id) || Boolean(args.ids), {
      message: "Provide id or ids.",
    }),
  outputSchema: z.union([
    z.object({ id: z.string(), archivedAt: z.string() }),
    recordingBatchSchema({ archivedAt: z.string() }),
  ]),
  run: async (args) => {
    const ids = requestedRecordingIds(args.id, args.ids);
    if (args.ids) {
      const batch = await applyToRecordings(ids, archiveOne);
      await refreshAfterBatch(batch.changed);
      return batch;
    }

    const id = ids[0];
    const { archivedAt } = await archiveOne(id);
    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Archived recording ${id}`);
    return { id, archivedAt };
  },
});

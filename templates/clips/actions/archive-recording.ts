import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  applyToRecordings,
  recordingBatchSchema,
  recordingIdsField,
  requestedRecordingIds,
} from "../server/lib/recording-batch.js";
import { assertRecordingNotExpired } from "../server/lib/recording-read-access.js";

async function archiveOne(id: string) {
  assertRecordingNotExpired(await assertAccess("recording", id, "editor"));
  const db = getDb();
  const rows = await db
    .select({ archivedAt: schema.recordings.archivedAt })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, id));
  if (!rows.length) {
    fail(`Recording not found: ${id}`, {
      errorCode: "recording_not_found",
      statusCode: 404,
    });
  }
  const { archivedAt } = rows[0];
  if (archivedAt) return { status: "unchanged" as const, archivedAt };

  const now = new Date().toISOString();
  await db
    .update(schema.recordings)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(schema.recordings.id, id));
  return { status: "changed" as const, archivedAt: now };
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
      if (batch.changed) {
        await writeAppState("refresh-signal", { ts: Date.now() });
      }
      return batch;
    }

    const id = ids[0];
    const { archivedAt } = await archiveOne(id);
    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Archived recording ${id}`);
    return { id, archivedAt };
  },
});

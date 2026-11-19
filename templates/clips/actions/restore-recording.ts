import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { isImageRecording } from "@shared/recording-kind";
import { and, eq, isNotNull, or } from "drizzle-orm";
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
import { hasDeleteClaim } from "../server/lib/screenshot-edits.js";

async function restoreOne(id: string) {
  assertRecordingNotExpired(await assertAccess("recording", id, "editor"));
  const db = getDb();

  const rows = await db
    .select({
      kind: schema.recordings.kind,
      editsJson: schema.recordings.editsJson,
      archivedAt: schema.recordings.archivedAt,
      trashedAt: schema.recordings.trashedAt,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, id));
  if (!rows.length) {
    fail(`Recording not found: ${id}`, {
      errorCode: "recording_not_found",
      statusCode: 404,
    });
  }
  const existing = rows[0];
  // A permanent delete has claimed this screenshot: it is running, or it
  // stopped part-way and some files — possibly the base still under
  // pending boxes — are gone. Either way it cannot come back whole.
  if (hasDeleteClaim(existing.editsJson)) {
    fail(
      "This screenshot was partly deleted and cannot be restored. Delete it again to finish.",
      { errorCode: "recording_partly_deleted", statusCode: 409 },
    );
  }
  if (!existing.archivedAt && !existing.trashedAt) {
    return { status: "unchanged" as const };
  }

  const now = new Date().toISOString();
  // Pinned to the unclaimed edits just read: a delete that claims the
  // screenshot in between must win, or a delete that then stops part-way
  // would put it back in the library without its base.
  // Only a row still archived or trashed is written, so of two calls racing
  // to restore it, one reports the change.
  const restored = await db
    .update(schema.recordings)
    .set({ archivedAt: null, trashedAt: null, updatedAt: now })
    .where(
      and(
        eq(schema.recordings.id, id),
        or(
          isNotNull(schema.recordings.archivedAt),
          isNotNull(schema.recordings.trashedAt),
        ),
        isImageRecording(existing)
          ? eq(schema.recordings.editsJson, existing.editsJson)
          : undefined,
      ),
    )
    .returning({ id: schema.recordings.id });
  if (!restored.length) {
    const after = await db
      .select({
        archivedAt: schema.recordings.archivedAt,
        trashedAt: schema.recordings.trashedAt,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, id));
    if (!after.length) {
      fail(`Recording not found: ${id}`, {
        errorCode: "recording_not_found",
        statusCode: 404,
      });
    }
    if (!after[0].archivedAt && !after[0].trashedAt) {
      return { status: "unchanged" as const };
    }
    fail(
      "This screenshot changed while it was being restored. Nothing was restored — try again.",
      { errorCode: "recording_restore_conflict", statusCode: 409 },
    );
  }
  return { status: "changed" as const };
}

export default defineAction({
  mcpApp: { compactCatalog: true },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  description:
    "Restore one or more recordings from archive or trash back to the library.",
  schema: z
    .object({
      id: z.string().min(1).optional().describe("Recording ID"),
      ids: recordingIdsField("restore").optional(),
    })
    .refine((args) => Boolean(args.id) || Boolean(args.ids), {
      message: "Provide id or ids.",
    }),
  outputSchema: z.union([
    z.object({ id: z.string() }),
    recordingBatchSchema({}),
  ]),
  run: async (args) => {
    const ids = requestedRecordingIds(args.id, args.ids);
    if (args.ids) {
      const batch = await applyToRecordings(ids, restoreOne);
      await refreshAfterBatch(batch.changed);
      return batch;
    }

    const id = ids[0];
    await restoreOne(id);
    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Restored recording ${id}`);
    return { id };
  },
});

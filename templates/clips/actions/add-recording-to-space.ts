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
import { parseSpaceIds, stringifySpaceIds } from "../server/lib/recordings.js";

const MAX_CAS_ATTEMPTS = 5;

async function setSpaceOne(
  recordingId: string,
  spaceId: string,
  op: "add" | "remove",
) {
  assertRecordingNotExpired(
    await assertAccess("recording", recordingId, "editor"),
  );
  const db = getDb();

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const rows = await db
      .select({ spaceIds: schema.recordings.spaceIds })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, recordingId));
    if (!rows.length) {
      fail(`Recording not found: ${recordingId}`, {
        errorCode: "recording_not_found",
        statusCode: 404,
      });
    }

    const previousSpaceIds = rows[0].spaceIds;
    const current = parseSpaceIds(previousSpaceIds);
    if (current.includes(spaceId) === (op === "add")) {
      return { status: "unchanged" as const, spaceIds: current };
    }
    const updated =
      op === "add"
        ? [...current, spaceId]
        : current.filter((id) => id !== spaceId);
    const nextSpaceIds = stringifySpaceIds(updated);

    const result = await db
      .update(schema.recordings)
      .set({ spaceIds: nextSpaceIds, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          eq(schema.recordings.spaceIds, previousSpaceIds),
        ),
      )
      .returning({ id: schema.recordings.id });

    if (result.length > 0) {
      return { status: "changed" as const, spaceIds: updated };
    }
    // Someone else changed spaceIds between our read and write — retry
    // against the now-current value.
  }

  fail(
    `Could not update spaces for recording ${recordingId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
    { errorCode: "recording_spaces_conflict", statusCode: 409 },
  );
}

export default defineAction({
  description:
    "Append or remove a space from the space list of one or more recordings. Use op='add' or op='remove'.",
  schema: z
    .object({
      recordingId: z.string().min(1).optional().describe("Recording id"),
      recordingIds: recordingIdsField(
        "add to or remove from the space",
      ).optional(),
      spaceId: z.string().min(1).describe("Space id to add / remove"),
      op: z
        .enum(["add", "remove"])
        .default("add")
        .describe("Whether to add or remove the space"),
    })
    .refine((args) => Boolean(args.recordingId) || Boolean(args.recordingIds), {
      message: "Provide recordingId or recordingIds.",
    }),
  outputSchema: z.union([
    z.object({ id: z.string(), spaceIds: z.array(z.string()) }),
    recordingBatchSchema({ spaceIds: z.array(z.string()) }),
  ]),
  run: async (args) => {
    const ids = requestedRecordingIds(args.recordingId, args.recordingIds);
    if (args.recordingIds) {
      const batch = await applyToRecordings(ids, (id) =>
        setSpaceOne(id, args.spaceId, args.op),
      );
      await refreshAfterBatch(batch.changed);
      return batch;
    }

    const id = ids[0];
    const { spaceIds } = await setSpaceOne(id, args.spaceId, args.op);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id, spaceIds };
  },
});

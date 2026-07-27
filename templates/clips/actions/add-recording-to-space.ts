import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseSpaceIds, stringifySpaceIds } from "../server/lib/recordings.js";

const MAX_CAS_ATTEMPTS = 5;

export default defineAction({
  description:
    "Append or remove a space from a recording's space list. Use op='add' or op='remove'.",
  schema: z.object({
    recordingId: z.string().min(1).describe("Recording id"),
    spaceId: z.string().min(1).describe("Space id to add / remove"),
    op: z
      .enum(["add", "remove"])
      .default("add")
      .describe("Whether to add or remove the space"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();

    // `db.transaction` alone does not serialize concurrent callers here —
    // under Postgres/Neon's default READ COMMITTED isolation, two callers can
    // both read the same spaceIds and the later UPDATE clobbers the earlier
    // one's change (a lost update). Row locks (`.for('update')`) aren't used
    // anywhere else in this codebase and aren't portable to SQLite, so
    // instead use an optimistic compare-and-swap retry loop on the existing
    // column: read the current raw spaceIds string, compute the next value,
    // then only commit if the column still matches what we read (mirrors the
    // CAS pattern in react-to-comment.ts). A concurrent writer that lands
    // first changes the column, the WHERE stops matching, and we retry the
    // read-modify-write against the fresh value.
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const [row] = await db
        .select({ spaceIds: schema.recordings.spaceIds })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId));

      if (!row) {
        throw new Error(`Recording not found: ${args.recordingId}`);
      }

      const previousSpaceIds = row.spaceIds;
      const current = parseSpaceIds(previousSpaceIds);
      const updated =
        args.op === "add"
          ? current.includes(args.spaceId)
            ? current
            : [...current, args.spaceId]
          : current.filter((id) => id !== args.spaceId);
      const nextSpaceIds = stringifySpaceIds(updated);

      const result = await db
        .update(schema.recordings)
        .set({ spaceIds: nextSpaceIds, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            eq(schema.recordings.spaceIds, previousSpaceIds),
          ),
        )
        .returning({ id: schema.recordings.id });

      if (result.length > 0) {
        await writeAppState("refresh-signal", { ts: Date.now() });
        return {
          id: args.recordingId,
          spaceIds: updated,
        };
      }
      // Someone else changed spaceIds between our read and write — retry
      // against the now-current value.
    }

    throw new Error(
      `Could not update spaces for recording ${args.recordingId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
    );
  },
});

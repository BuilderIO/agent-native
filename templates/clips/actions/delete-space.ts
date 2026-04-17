/**
 * Delete a space.
 *
 * Clears spaceIds from all recordings that referenced it, removes space_members
 * rows for the space, then deletes the space itself.
 *
 * Usage:
 *   pnpm action delete-space --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { parseSpaceIds, stringifySpaceIds } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Delete a space. Removes the space row, its members, and clears the space id from any recordings that referenced it.",
  schema: z.object({
    id: z.string().describe("Space id"),
  }),
  run: async (args) => {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, args.id));
    if (!existing) throw new Error(`Space not found: ${args.id}`);

    // Clean recordings.spaceIds — use LIKE to find rows that reference the id.
    const needle = `%"${args.id.replace(/%/g, "")}"%`;
    const affected = await db
      .select()
      .from(schema.recordings)
      .where(sql`${schema.recordings.spaceIds} LIKE ${needle}`);

    for (const r of affected) {
      const ids = parseSpaceIds(r.spaceIds).filter((x) => x !== args.id);
      await db
        .update(schema.recordings)
        .set({
          spaceIds: stringifySpaceIds(ids),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.recordings.id, r.id));
    }

    await db
      .delete(schema.spaceMembers)
      .where(eq(schema.spaceMembers.spaceId, args.id));

    await db.delete(schema.spaces).where(eq(schema.spaces.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(
      `Deleted space ${args.id} and cleared it from ${affected.length} recording(s)`,
    );
    return {
      id: args.id,
      recordingsCleaned: affected.length,
    };
  },
});

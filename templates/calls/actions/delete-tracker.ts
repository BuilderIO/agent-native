/**
 * Delete a tracker definition AND all of its hits across every call.
 *
 * Usage:
 *   pnpm action delete-tracker --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Delete a tracker definition and all associated tracker_hits rows.",
  schema: z.object({
    id: z.string().describe("Tracker ID"),
  }),
  run: async (args) => {
    const db = getDb();

    const [existing] = await db
      .select({ id: schema.trackerDefinitions.id })
      .from(schema.trackerDefinitions)
      .where(eq(schema.trackerDefinitions.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`Tracker not found: ${args.id}`);

    await db
      .delete(schema.trackerHits)
      .where(eq(schema.trackerHits.trackerId, args.id));

    await db
      .delete(schema.trackerDefinitions)
      .where(eq(schema.trackerDefinitions.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Deleted tracker ${args.id}`);
    return { id: args.id, deleted: true };
  },
});

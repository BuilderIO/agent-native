/**
 * Archive a recording by setting archivedAt.
 *
 * Usage:
 *   pnpm action archive-recording --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Archive a recording. Hides it from the main library but keeps all data intact. Use restore-recording to undo.",
  schema: z.object({
    id: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, args.id),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    if (!existing) throw new Error(`Recording not found: ${args.id}`);

    const now = new Date().toISOString();
    await db
      .update(schema.recordings)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(schema.recordings.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Archived recording ${args.id}`);
    return { id: args.id, archivedAt: now };
  },
});

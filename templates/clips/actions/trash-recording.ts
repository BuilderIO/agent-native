/**
 * Move a recording to the trash by setting trashedAt.
 *
 * Usage:
 *   pnpm action trash-recording --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Move a recording to trash. Soft-delete — use restore-recording to undo, or delete-recording-permanent to remove forever.",
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
          eq(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    if (!existing) throw new Error(`Recording not found: ${args.id}`);

    const now = new Date().toISOString();
    await db
      .update(schema.recordings)
      .set({ trashedAt: now, updatedAt: now })
      .where(eq(schema.recordings.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Trashed recording ${args.id}`);
    return { id: args.id, trashedAt: now };
  },
});

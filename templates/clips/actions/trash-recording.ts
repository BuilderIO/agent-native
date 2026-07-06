/**
 * Move a recording to the trash by setting trashedAt.
 *
 * Usage:
 *   pnpm action trash-recording --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Move a recording to trash. Soft-delete — use restore-recording to undo, or delete-recording-permanent to remove forever.",
  schema: z.object({
    id: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.id, "editor");

    const db = getDb();

    const [existing] = await db
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));
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

/**
 * Restore a recording — clears archivedAt and trashedAt.
 *
 * Usage:
 *   pnpm action restore-recording --id=<id>
 */

import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { hasDeleteClaim } from "../server/lib/screenshot-edits.js";

export default defineAction({
  description: "Restore a recording from archive or trash back to the library.",
  schema: z.object({
    id: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.id, "editor");

    const db = getDb();

    const [existing] = await db
      .select({
        id: schema.recordings.id,
        editsJson: schema.recordings.editsJson,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));
    if (!existing) throw new Error(`Recording not found: ${args.id}`);
    // A permanent delete has claimed this screenshot: it is running, or it
    // stopped part-way and some files — possibly the base still under
    // pending boxes — are gone. Either way it cannot come back whole.
    if (hasDeleteClaim(existing.editsJson)) {
      throw new Error(
        "This screenshot was partly deleted and cannot be restored. Delete it again to finish.",
      );
    }

    const now = new Date().toISOString();
    await db
      .update(schema.recordings)
      .set({ archivedAt: null, trashedAt: null, updatedAt: now })
      .where(eq(schema.recordings.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Restored recording ${args.id}`);
    return { id: args.id };
  },
});

/**
 * Reset a recording's non-destructive edits back to defaults.
 *
 * Clears `editsJson` entirely — trims, blurs, thumbnail spec. Does NOT touch
 * chapters (those live on `chaptersJson`) nor the stored `thumbnailUrl` /
 * `animatedThumbnailUrl` columns, so the user's current thumbnail stays in
 * place.
 *
 * Usage:
 *   pnpm action clear-edits --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import { DEFAULT_EDITS, serializeEdits } from "../app/lib/timestamp-mapping.js";

export default defineAction({
  description:
    "Reset a recording's edits (trims, blurs, thumbnail spec) back to defaults. Chapters and uploaded thumbnail URLs are kept.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select()
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, args.recordingId),
          eq(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    if (!existing) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }

    await db
      .update(schema.recordings)
      .set({
        editsJson: serializeEdits({ ...DEFAULT_EDITS }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recordings.id, args.recordingId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Cleared edits on ${args.recordingId}`);

    return { id: args.recordingId, editsJson: { ...DEFAULT_EDITS } };
  },
});

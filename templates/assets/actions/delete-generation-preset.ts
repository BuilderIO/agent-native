import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete a generation preset from an asset library. Existing generation runs keep their captured settings.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    const db = getDb();
    const [preset] = await db
      .select()
      .from(schema.assetGenerationPresets)
      .where(eq(schema.assetGenerationPresets.id, id))
      .limit(1);
    if (!preset) throw new Error("Generation preset not found.");
    await assertAccess("asset-library", preset.libraryId, "editor");
    const [referencingSession] = await db
      .select({ id: schema.assetGenerationSessions.id })
      .from(schema.assetGenerationSessions)
      .where(eq(schema.assetGenerationSessions.presetId, id))
      .limit(1);
    if (referencingSession) {
      throw new Error(
        "Generation preset is used by an existing handoff session and cannot be deleted.",
      );
    }
    await db
      .delete(schema.assetGenerationPresets)
      .where(eq(schema.assetGenerationPresets.id, id));
    return { id, deleted: true };
  },
});

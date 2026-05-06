import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete an image library and its collections, assets, generation runs, and shares. Requires admin access.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    await assertAccess("image-library", id, "admin");
    const db = getDb();
    await db
      .delete(schema.imageAssets)
      .where(eq(schema.imageAssets.libraryId, id));
    await db
      .delete(schema.imageGenerationRuns)
      .where(eq(schema.imageGenerationRuns.libraryId, id));
    await db
      .delete(schema.imageCollections)
      .where(eq(schema.imageCollections.libraryId, id));
    await db
      .delete(schema.imageLibraryShares)
      .where(eq(schema.imageLibraryShares.resourceId, id));
    await db
      .delete(schema.imageLibraries)
      .where(eq(schema.imageLibraries.id, id));
    return { id, deleted: true };
  },
});

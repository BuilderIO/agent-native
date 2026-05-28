import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete an asset library and its collections, assets, generation runs, folders, and shares. Requires admin access.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    await assertAccess("asset-library", id, "admin");
    const db = getDb();
    await db.delete(schema.assets).where(eq(schema.assets.libraryId, id));
    await db
      .delete(schema.assetGenerationRuns)
      .where(eq(schema.assetGenerationRuns.libraryId, id));
    await db
      .delete(schema.assetCollections)
      .where(eq(schema.assetCollections.libraryId, id));
    await db
      .delete(schema.assetFolders)
      .where(eq(schema.assetFolders.libraryId, id));
    await db
      .delete(schema.assetLibraryShares)
      .where(eq(schema.assetLibraryShares.resourceId, id));
    await db
      .delete(schema.assetLibraries)
      .where(eq(schema.assetLibraries.id, id));
    return { id, deleted: true };
  },
});

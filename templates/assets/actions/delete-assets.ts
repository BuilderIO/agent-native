import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete multiple asset rows. Requires editor access to every affected asset library.",
  schema: z.object({
    ids: z.array(z.string().min(1)).min(1).describe("Asset IDs to delete."),
  }),
  run: async ({ ids }) => {
    const uniqueIds = Array.from(new Set(ids));
    const db = getDb();
    const matchedAssets = await db
      .select({
        id: schema.assets.id,
        libraryId: schema.assets.libraryId,
      })
      .from(schema.assets)
      .where(inArray(schema.assets.id, uniqueIds));

    const matchedIds = new Set(matchedAssets.map((asset) => asset.id));
    const libraryIds = Array.from(
      new Set(matchedAssets.map((asset) => asset.libraryId)),
    );

    for (const libraryId of libraryIds) {
      await assertAccess("asset-library", libraryId, "editor");
    }

    const deletedIds = uniqueIds.filter((id) => matchedIds.has(id));
    const missingIds = uniqueIds.filter((id) => !matchedIds.has(id));

    if (deletedIds.length > 0) {
      await db
        .delete(schema.assets)
        .where(inArray(schema.assets.id, deletedIds));
    }

    return {
      requestedCount: ids.length,
      uniqueRequestedCount: uniqueIds.length,
      foundCount: deletedIds.length,
      deletedCount: deletedIds.length,
      missingCount: missingIds.length,
      libraryIds,
      deletedIds,
      missingIds,
    };
  },
});

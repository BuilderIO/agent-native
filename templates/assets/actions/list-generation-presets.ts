import { defineAction } from "@agent-native/core";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireLibrary, serializeGenerationPreset } from "./_helpers.js";

export default defineAction({
  description:
    "List reusable generation presets for a library, such as social images, blog heroes, and diagrams. This is the required first step for ad-hoc generation requests: if a preset matches, generate with its presetId instead of presetless settings. Results include settings.presetReferences, the reference board used to match named people, products, and backdrops in the request.",
  schema: z.object({
    libraryId: z.string(),
    collectionId: z.string().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ libraryId, collectionId }) => {
    await requireLibrary(libraryId);
    const filters = [eq(schema.assetGenerationPresets.libraryId, libraryId)];
    if (collectionId) {
      filters.push(
        or(
          eq(schema.assetGenerationPresets.collectionId, collectionId),
          isNull(schema.assetGenerationPresets.collectionId),
        )!,
      );
    }
    const presets = await getDb()
      .select()
      .from(schema.assetGenerationPresets)
      .where(and(...filters))
      .orderBy(
        asc(schema.assetGenerationPresets.sortOrder),
        asc(schema.assetGenerationPresets.title),
      );
    return {
      count: presets.length,
      presets: presets.map(serializeGenerationPreset),
    };
  },
});

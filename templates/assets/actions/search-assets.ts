import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { parseJson } from "../server/lib/json.js";
import { requireLibrary, serializeAsset } from "./_helpers.js";
import { ASSET_MEDIA_TYPES, IMAGE_CATEGORIES } from "../shared/api.js";

export default defineAction({
  description:
    "Search asset titles, descriptions, alt text, prompts, filenames, categories, and generated metadata across one library or all accessible libraries.",
  schema: z.object({
    libraryId: z.string().optional(),
    query: z.string().min(1),
    mediaType: z.enum(ASSET_MEDIA_TYPES).optional(),
    category: z.enum(IMAGE_CATEGORIES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ libraryId, query, mediaType, category, limit }) => {
    const db = getDb();
    const libraryIds = libraryId
      ? [(await requireLibrary(libraryId)).id]
      : (
          await db
            .select({ id: schema.assetLibraries.id })
            .from(schema.assetLibraries)
            .where(
              accessFilter(schema.assetLibraries, schema.assetLibraryShares),
            )
        ).map((row) => row.id);

    if (!libraryIds.length) return { count: 0, assets: [] };

    const filters = [inArray(schema.assets.libraryId, libraryIds)];
    if (mediaType) filters.push(eq(schema.assets.mediaType, mediaType));
    const normalizedQuery = query.trim().toLowerCase();
    const rows = await db
      .select()
      .from(schema.assets)
      .where(and(...filters))
      .orderBy(desc(schema.assets.updatedAt));

    const assets = rows
      .filter((asset) => {
        const metadata = parseJson<Record<string, unknown>>(asset.metadata, {});
        if (category && metadata.category !== category) return false;
        const searchable = [
          asset.title,
          asset.description,
          asset.altText,
          asset.prompt,
          asset.mimeType,
          asset.role,
          asset.status,
          metadata.category,
          metadata.description,
          metadata.originalName,
          metadata.prompt,
          metadata.compiledPrompt,
        ]
          .filter((value): value is string => typeof value === "string")
          .join("\n")
          .toLowerCase();
        return searchable.includes(normalizedQuery);
      })
      .slice(0, limit)
      .map(serializeAsset);

    return { count: assets.length, assets };
  },
});

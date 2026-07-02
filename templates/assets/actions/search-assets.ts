import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { ASSET_MEDIA_TYPES, IMAGE_CATEGORIES } from "../shared/api.js";
import {
  assetMatchesSearch,
  includeCandidatesSchema,
  shouldIncludeAssetInLibraryResults,
} from "./_asset-search.js";
import {
  buildAssetLineage,
  requireLibrary,
  serializeAsset,
} from "./_helpers.js";

export default defineAction({
  description:
    "Search asset titles, descriptions, alt text, prompts, filenames, categories, and generated metadata across one library or all accessible libraries.",
  schema: z.object({
    libraryId: z.string().optional(),
    query: z.string().min(1),
    mediaType: z.enum(ASSET_MEDIA_TYPES).optional(),
    category: z.enum(IMAGE_CATEGORIES).optional(),
    includeCandidates: includeCandidatesSchema.describe(
      "Include unsaved generated candidates in search results.",
    ),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({
    libraryId,
    query,
    mediaType,
    category,
    includeCandidates,
    limit,
  }) => {
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
    const [rows, lineageRows] = await Promise.all([
      db
        .select()
        .from(schema.assets)
        .where(and(...filters))
        .orderBy(desc(schema.assets.updatedAt)),
      db
        .select()
        .from(schema.assets)
        .where(inArray(schema.assets.libraryId, libraryIds)),
    ]);
    const lineageById = buildAssetLineage(lineageRows);

    const assets = rows
      .filter((asset) =>
        shouldIncludeAssetInLibraryResults(asset, includeCandidates),
      )
      .filter((asset) => assetMatchesSearch(asset, normalizedQuery, category))
      .slice(0, limit)
      .map((asset) => serializeAsset(asset, lineageById.get(asset.id) ?? null));

    return { count: assets.length, assets };
  },
});

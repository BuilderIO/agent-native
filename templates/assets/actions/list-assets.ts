import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
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
    "List DAM assets in one library, or across all accessible libraries when libraryId is omitted. Optionally filter by folder, collection, media type, status, role, category, or text query.",
  schema: z.object({
    libraryId: z.string().optional(),
    collectionId: z.string().optional(),
    folderId: z.string().nullable().optional(),
    mediaType: z.enum(ASSET_MEDIA_TYPES).optional(),
    status: z.string().optional(),
    role: z.string().optional(),
    category: z.enum(IMAGE_CATEGORIES).optional(),
    query: z.string().optional(),
    includeCandidates: includeCandidatesSchema.describe(
      "Include unsaved generated candidate assets. Defaults to false so picker/search views only expose approved or reference assets unless a generation flow opts in.",
    ),
    candidateRunIds: z
      .preprocess(
        (value) => (typeof value === "string" ? [value] : value),
        z.array(z.string()),
      )
      .optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({
    libraryId,
    collectionId,
    folderId,
    mediaType,
    status,
    role,
    category,
    query,
    includeCandidates,
    candidateRunIds,
  }) => {
    const db = getDb();
    const libraryRows = libraryId
      ? [await requireLibrary(libraryId)]
      : await db
          .select({
            id: schema.assetLibraries.id,
            title: schema.assetLibraries.title,
          })
          .from(schema.assetLibraries)
          .where(
            and(
              accessFilter(schema.assetLibraries, schema.assetLibraryShares),
              isNull(schema.assetLibraries.archivedAt),
            ),
          );
    const libraryIds = libraryRows.map((library) => library.id);
    if (!libraryIds.length) return { count: 0, assets: [] };

    const libraryTitleById = new Map(
      libraryRows.map((library) => [library.id, library.title]),
    );
    const filters = [
      libraryId
        ? eq(schema.assets.libraryId, libraryId)
        : inArray(schema.assets.libraryId, libraryIds),
    ];
    if (collectionId)
      filters.push(eq(schema.assets.collectionId, collectionId));
    if (folderId !== undefined) {
      filters.push(
        folderId === null
          ? isNull(schema.assets.folderId)
          : eq(schema.assets.folderId, folderId),
      );
    }
    if (mediaType) filters.push(eq(schema.assets.mediaType, mediaType));
    if (status) filters.push(eq(schema.assets.status, status));
    if (role) filters.push(eq(schema.assets.role, role));
    const normalizedQuery = query?.trim().toLowerCase();
    const candidateRunIdSet = new Set(candidateRunIds ?? []);
    const [rows, lineageRows] = await Promise.all([
      db
        .select()
        .from(schema.assets)
        .where(and(...filters))
        .orderBy(desc(schema.assets.createdAt)),
      // Lineage labels (Original N / Variation N) are numbered across the whole
      // library and resolve each variation's parent label, so this must stay
      // library-scoped rather than narrowing to the same folder/collection
      // filter as the primary query. Project only the columns
      // `buildAssetLineage` reads instead of pulling full rows for every asset
      // in the library on each list call.
      db
        .select({
          id: schema.assets.id,
          role: schema.assets.role,
          generationRunId: schema.assets.generationRunId,
          metadata: schema.assets.metadata,
          createdAt: schema.assets.createdAt,
        })
        .from(schema.assets)
        .where(
          libraryId
            ? eq(schema.assets.libraryId, libraryId)
            : inArray(schema.assets.libraryId, libraryIds),
        ),
    ]);
    const lineageById = buildAssetLineage(lineageRows);
    const assets = rows
      .filter((asset) =>
        shouldIncludeAssetInLibraryResults(
          asset,
          includeCandidates ||
            status === "candidate" ||
            candidateRunIdSet.size > 0,
        ),
      )
      .filter((asset) => {
        if (!candidateRunIdSet.size) return true;
        if (!(asset.role === "generated" && asset.status === "candidate")) {
          return false;
        }
        return Boolean(
          asset.generationRunId && candidateRunIdSet.has(asset.generationRunId),
        );
      })
      .filter((asset) => assetMatchesSearch(asset, normalizedQuery, category))
      .map((asset) => ({
        ...serializeAsset(asset, lineageById.get(asset.id) ?? null),
        libraryTitle: libraryTitleById.get(asset.libraryId) ?? null,
      }));
    return { count: assets.length, assets };
  },
});

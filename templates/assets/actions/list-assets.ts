import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  buildAssetLineage,
  requireLibrary,
  serializeAsset,
} from "./_helpers.js";
import { ASSET_MEDIA_TYPES, IMAGE_CATEGORIES } from "../shared/api.js";
import {
  assetMatchesSearch,
  includeCandidatesSchema,
  shouldIncludeAssetInLibraryResults,
} from "./_asset-search.js";

export default defineAction({
  description:
    "List DAM assets in a library, optionally filtered by folder, collection, media type, status, role, category, or text query.",
  schema: z.object({
    libraryId: z.string(),
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
    candidateRunIds: z.array(z.string()).optional(),
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
    await requireLibrary(libraryId);
    const filters = [eq(schema.assets.libraryId, libraryId)];
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
    const db = getDb();
    const [rows, lineageRows] = await Promise.all([
      db
        .select()
        .from(schema.assets)
        .where(and(...filters))
        .orderBy(desc(schema.assets.createdAt)),
      db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.libraryId, libraryId)),
    ]);
    const lineageById = buildAssetLineage(lineageRows);
    const assets = rows
      .filter((asset) =>
        shouldIncludeAssetInLibraryResults(
          asset,
          includeCandidates || status === "candidate",
        ),
      )
      .filter((asset) => {
        if (!candidateRunIdSet.size) return true;
        if (!(asset.role === "generated" && asset.status === "candidate")) {
          return true;
        }
        return Boolean(
          asset.generationRunId && candidateRunIdSet.has(asset.generationRunId),
        );
      })
      .filter((asset) => assetMatchesSearch(asset, normalizedQuery, category))
      .map((asset) => serializeAsset(asset, lineageById.get(asset.id) ?? null));
    return { count: assets.length, assets };
  },
});

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { requireLibrary, serializeAsset } from "./_helpers.js";
import { ASSET_MEDIA_TYPES, IMAGE_CATEGORIES } from "../shared/api.js";
import { parseJson } from "../server/lib/json.js";

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
    const rows = await getDb()
      .select()
      .from(schema.assets)
      .where(and(...filters))
      .orderBy(desc(schema.assets.createdAt));
    const assets = rows
      .filter((asset) => {
        const metadata = parseJson<Record<string, unknown>>(asset.metadata, {});
        if (category && metadata.category !== category) return false;
        if (!normalizedQuery) return true;
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
      .map(serializeAsset);
    return { count: assets.length, assets };
  },
});

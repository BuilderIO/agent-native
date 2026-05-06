import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { requireLibrary, serializeAsset } from "./_helpers.js";
import { IMAGE_CATEGORIES } from "../shared/api.js";
import { parseJson } from "../server/lib/json.js";

export default defineAction({
  description:
    "List image assets in a library, optionally filtered by collection, status, role, or category.",
  schema: z.object({
    libraryId: z.string(),
    collectionId: z.string().optional(),
    status: z.string().optional(),
    role: z.string().optional(),
    category: z.enum(IMAGE_CATEGORIES).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ libraryId, collectionId, status, role, category }) => {
    await requireLibrary(libraryId);
    const filters = [eq(schema.imageAssets.libraryId, libraryId)];
    if (collectionId)
      filters.push(eq(schema.imageAssets.collectionId, collectionId));
    if (status) filters.push(eq(schema.imageAssets.status, status));
    if (role) filters.push(eq(schema.imageAssets.role, role));
    const rows = await getDb()
      .select()
      .from(schema.imageAssets)
      .where(and(...filters))
      .orderBy(desc(schema.imageAssets.createdAt));
    const assets = rows
      .filter((asset) => {
        if (!category) return true;
        const metadata = parseJson<{ category?: string }>(asset.metadata, {});
        return metadata.category === category;
      })
      .map(serializeAsset);
    return { count: assets.length, assets };
  },
});

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, inArray, isNull } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { serializeAsset, serializeLibrary } from "./_helpers.js";

export default defineAction({
  description:
    "List asset libraries accessible to the current user, including counts and cover thumbnails.",
  schema: z.object({
    compact: z.coerce.boolean().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ compact }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.assetLibraries)
      .where(
        and(
          accessFilter(schema.assetLibraries, schema.assetLibraryShares),
          isNull(schema.assetLibraries.archivedAt),
        ),
      )
      .orderBy(desc(schema.assetLibraries.updatedAt));
    const assets = rows.length
      ? await db
          .select()
          .from(schema.assets)
          .where(
            inArray(
              schema.assets.libraryId,
              rows.map((row) => row.id),
            ),
          )
      : [];
    const libraries = rows.map((row) => {
      const libAssets = assets.filter((asset) => asset.libraryId === row.id);
      const cover =
        libAssets.find((asset) => asset.id === row.coverAssetId) ??
        libAssets.find((asset) => asset.status === "saved") ??
        libAssets[0];
      const base = serializeLibrary(row);
      return compact
        ? { id: base.id, title: base.title, description: base.description }
        : {
            ...base,
            referenceCount: libAssets.filter(
              (asset) => asset.status === "reference",
            ).length,
            generatedCount: libAssets.filter(
              (asset) => asset.role === "generated",
            ).length,
            videoCount: libAssets.filter(
              (asset) =>
                asset.mediaType === "video" ||
                asset.mimeType?.startsWith("video/"),
            ).length,
            coverAsset: cover ? serializeAsset(cover) : null,
          };
    });
    return { count: libraries.length, libraries };
  },
});

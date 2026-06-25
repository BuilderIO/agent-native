import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseJson } from "../server/lib/json.js";
import { shouldIncludeAssetInLibraryResults } from "./_asset-search.js";
import { serializeAsset, serializeLibrary } from "./_helpers.js";

function isImageAsset(asset: typeof schema.assets.$inferSelect): boolean {
  return (
    asset.mediaType !== "video" &&
    !asset.mimeType?.toLowerCase().startsWith("video/")
  );
}

function isContentOnlyReference(
  asset: typeof schema.assets.$inferSelect,
): boolean {
  if (asset.role === "subject_reference") return true;
  const metadata = parseJson<Record<string, unknown>>(asset.metadata, {});
  return metadata.intent === "subject";
}

function isReusableReference(
  asset: typeof schema.assets.$inferSelect,
): boolean {
  return asset.status === "reference" && !isContentOnlyReference(asset);
}

function previewPriority(asset: typeof schema.assets.$inferSelect): number {
  if (isReusableReference(asset)) return 0;
  if (asset.status === "saved") return 1;
  if (asset.role === "generated") return 2;
  return 3;
}

function sortPreviewAssets(
  assets: Array<typeof schema.assets.$inferSelect>,
): Array<typeof schema.assets.$inferSelect> {
  return [...assets].sort((a, b) => {
    const priorityDelta = previewPriority(a) - previewPriority(b);
    if (priorityDelta) return priorityDelta;
    const dateDelta =
      Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? "");
    if (Number.isFinite(dateDelta) && dateDelta) return dateDelta;
    return a.id.localeCompare(b.id);
  });
}

function uniqueAssets(
  assets: Array<typeof schema.assets.$inferSelect | undefined>,
): Array<typeof schema.assets.$inferSelect> {
  const seen = new Set<string>();
  const unique: Array<typeof schema.assets.$inferSelect> = [];
  for (const asset of assets) {
    if (!asset || seen.has(asset.id)) continue;
    seen.add(asset.id);
    unique.push(asset);
  }
  return unique;
}

export default defineAction({
  description:
    "List asset libraries accessible to the current user, including counts and preview thumbnails.",
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
      const visibleAssets = libAssets.filter((asset) =>
        shouldIncludeAssetInLibraryResults(asset),
      );
      const imageAssets = sortPreviewAssets(visibleAssets.filter(isImageAsset));
      const cover =
        imageAssets.find((asset) => asset.id === row.coverAssetId) ??
        imageAssets.find((asset) => asset.status === "saved") ??
        imageAssets[0];
      const previewAssets = uniqueAssets([cover, ...imageAssets]).slice(0, 4);
      const base = serializeLibrary(row);
      return compact
        ? { id: base.id, title: base.title, description: base.description }
        : {
            ...base,
            referenceCount: visibleAssets.filter((asset) =>
              isReusableReference(asset),
            ).length,
            generatedCount: visibleAssets.filter(
              (asset) => asset.role === "generated",
            ).length,
            videoCount: visibleAssets.filter(
              (asset) =>
                asset.mediaType === "video" ||
                asset.mimeType?.startsWith("video/"),
            ).length,
            coverAsset: cover ? serializeAsset(cover) : null,
            previewAssets: previewAssets.map(serializeAsset),
          };
    });
    return { count: libraries.length, libraries };
  },
});

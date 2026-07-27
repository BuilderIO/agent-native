import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { DEFAULT_LIBRARY_PRESETS } from "../shared/library-presets.js";
import {
  buildAssetLineage,
  getAssetOrThrow,
  serializeAsset,
} from "./_helpers.js";

function starterAsset(id: string) {
  for (const preset of DEFAULT_LIBRARY_PRESETS) {
    for (const reference of preset.referenceImages) {
      const starterId = `starter-${preset.id}-${reference.id}`;
      if (id !== starterId) continue;
      const asset = serializeAsset(
        {
          id: starterId,
          libraryId: `starter:${preset.id}`,
          collectionId: null,
          folderId: null,
          mediaType: "image",
          role: "reference",
          status: "ready",
          title: reference.title,
          description: reference.description,
          altText: reference.title,
          prompt: null,
          model: null,
          aspectRatio: null,
          imageSize: null,
          mimeType: "image/webp",
          width: 900,
          height: 900,
          durationSeconds: null,
          sizeBytes: null,
          sourceUrl: reference.sourceUrl,
          generationRunId: null,
          metadata: JSON.stringify({
            isStarterAsset: true,
            presetId: preset.id,
            sourceName: reference.sourceName,
            author: reference.author,
            licenseName: reference.licenseName,
            licenseUrl: reference.licenseUrl,
          }),
          createdAt: null,
          updatedAt: null,
          objectKey: reference.path,
          thumbnailObjectKey: reference.path,
        },
        null,
      );
      return {
        ...asset,
        downloadUrl: reference.downloadUrl || asset.previewUrl,
      };
    }
  }
  return null;
}

export default defineAction({
  description:
    "Get a single DAM asset by ID with preview, download, and embed URLs.",
  schema: z.object({ id: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    const starter = starterAsset(id);
    if (starter) return starter;

    const asset = await getAssetOrThrow(id);
    const libraryAssets = await getDb()
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.libraryId, asset.libraryId));
    const lineageById = buildAssetLineage(libraryAssets);
    return serializeAsset(asset, lineageById.get(asset.id) ?? null);
  },
});

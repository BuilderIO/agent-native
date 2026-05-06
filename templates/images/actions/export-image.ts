import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getPresignedObjectUrl } from "../server/lib/storage.js";
import { absoluteUrl } from "../server/lib/json.js";
import { getAssetOrThrow, serializeAsset } from "./_helpers.js";

export default defineAction({
  description:
    "Export an image asset for use by another agent or app. Returns stable preview routes plus a temporary object-storage download URL when available.",
  schema: z.object({
    assetId: z.string(),
    expiresInSeconds: z.coerce.number().min(60).max(86400).default(1800),
  }),
  run: async ({ assetId, expiresInSeconds }) => {
    const asset = await getAssetOrThrow(assetId);
    const signed = await getPresignedObjectUrl(
      asset.objectKey,
      expiresInSeconds,
    );
    const serialized = serializeAsset(asset);
    return {
      ...serialized,
      downloadUrl:
        signed?.url ??
        absoluteUrl(`/api/assets/${asset.id}/content?download=1`),
      downloadUrlExpiresAt: signed?.expiresAt ?? null,
      artifactType: "image",
    };
  },
});

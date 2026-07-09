import { inArray } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import { normalizePresetReferences } from "../server/lib/preset-references.js";

export async function assertPresetSkeletonAssetsValid(input: {
  db: any;
  libraryId: string;
  settings: unknown;
}) {
  const spec =
    input.settings && typeof input.settings === "object"
      ? (input.settings as { skeletonSpec?: unknown }).skeletonSpec
      : null;
  if (!spec || typeof spec !== "object") return;
  const skeleton = spec as {
    background?: { type?: unknown; assetId?: unknown };
    mask?: { type?: unknown; assetId?: unknown };
  };
  const backgroundAssetId =
    skeleton.background?.type === "asset" &&
    typeof skeleton.background.assetId === "string"
      ? skeleton.background.assetId
      : "";
  const maskAssetId =
    skeleton.mask?.type === "asset" && typeof skeleton.mask.assetId === "string"
      ? skeleton.mask.assetId
      : "";
  if (!backgroundAssetId) return;

  const assetIds = maskAssetId
    ? [backgroundAssetId, maskAssetId]
    : [backgroundAssetId];
  const rows = await input.db
    .select({
      id: schema.assets.id,
      libraryId: schema.assets.libraryId,
      width: schema.assets.width,
      height: schema.assets.height,
    })
    .from(schema.assets)
    .where(inArray(schema.assets.id, assetIds));
  const background = rows.find((asset: any) => asset.id === backgroundAssetId);
  if (!background || background.libraryId !== input.libraryId) {
    throw new Error("Skeleton image must belong to this asset library.");
  }
  if (!maskAssetId) return;
  const mask = rows.find((asset: any) => asset.id === maskAssetId);
  if (!mask || mask.libraryId !== input.libraryId) {
    throw new Error("Skeleton mask must belong to this asset library.");
  }
  if (
    typeof background.width !== "number" ||
    typeof background.height !== "number" ||
    typeof mask.width !== "number" ||
    typeof mask.height !== "number"
  ) {
    return;
  }
  if (background.width !== mask.width || background.height !== mask.height) {
    throw new Error(
      "Skeleton inpainting mask must be the same pixel size as the background plate.",
    );
  }
}

export async function assertPresetReferenceAssetsValid(input: {
  db: any;
  libraryId: string;
  settings: unknown;
}) {
  const rawReferences =
    input.settings && typeof input.settings === "object"
      ? (input.settings as { presetReferences?: unknown }).presetReferences
      : null;
  const references = normalizePresetReferences(rawReferences);
  const assetIds = [...new Set(references.flatMap((entry) => entry.assetIds))];
  if (!assetIds.length) return;

  const rows = await input.db
    .select({
      id: schema.assets.id,
      libraryId: schema.assets.libraryId,
      mimeType: schema.assets.mimeType,
      status: schema.assets.status,
    })
    .from(schema.assets)
    .where(inArray(schema.assets.id, assetIds));
  const byId = new Map<string, any>(
    (rows as any[]).map((asset) => [asset.id, asset]),
  );
  const valid = assetIds.every((assetId) => {
    const asset = byId.get(assetId);
    return (
      asset &&
      asset.libraryId === input.libraryId &&
      typeof asset.mimeType === "string" &&
      asset.mimeType.startsWith("image/") &&
      asset.status !== "archived" &&
      asset.status !== "failed"
    );
  });
  if (!valid) {
    throw new Error(
      "Reference board images must be images in this asset library.",
    );
  }
}

export function assertPresetReferenceModelCompatible(input: {
  model: string | null | undefined;
  settings: unknown;
}) {
  const rawReferences =
    input.settings && typeof input.settings === "object"
      ? (input.settings as { presetReferences?: unknown }).presetReferences
      : null;
  const references = normalizePresetReferences(rawReferences);
  if (
    input.model === "gemini-2.5-flash-image" &&
    references.some((entry) => entry.role === "subject")
  ) {
    throw new Error(
      "Subject reference entries need a model with character consistency. Use gemini-3.1-flash-image, gemini-3-pro-image, gpt-image-1, or gpt-image-2.",
    );
  }
}

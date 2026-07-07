import { inArray } from "drizzle-orm";

import { schema } from "../server/db/index.js";

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
  if (!backgroundAssetId || !maskAssetId) return;

  const rows = await input.db
    .select({
      id: schema.assets.id,
      libraryId: schema.assets.libraryId,
      width: schema.assets.width,
      height: schema.assets.height,
    })
    .from(schema.assets)
    .where(inArray(schema.assets.id, [backgroundAssetId, maskAssetId]));
  const background = rows.find((asset: any) => asset.id === backgroundAssetId);
  const mask = rows.find((asset: any) => asset.id === maskAssetId);
  if (
    !background ||
    !mask ||
    background.libraryId !== input.libraryId ||
    mask.libraryId !== input.libraryId
  ) {
    throw new Error(
      "Skeleton image and mask must belong to this asset library.",
    );
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

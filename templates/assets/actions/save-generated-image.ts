import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  deleteAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { markAssetSaved } from "../server/handlers/assets.js";
import { getAssetOrThrow, serializeAsset } from "./_helpers.js";
import type { AssetVariantState } from "../shared/api.js";

export default defineAction({
  description:
    "Save a generated asset candidate to the library. Accepts an assetId directly or a variant slot ID from application_state.asset-variants.",
  schema: z.object({
    assetId: z.string().optional(),
    slotId: z.string().optional(),
    folderId: z.string().min(1).nullable().optional(),
  }),
  run: async ({ assetId, slotId, folderId }) => {
    let resolvedAssetId = assetId;
    const raw = (await readAppState("asset-variants")) as unknown | null;
    const legacyRaw =
      raw ??
      ((await readAppState("image-variants").catch(() => null)) as
        | unknown
        | null);
    const variants = (raw ?? null) as AssetVariantState | null;
    const legacyVariants = (legacyRaw ?? null) as AssetVariantState | null;
    const activeVariants = variants ?? legacyVariants;
    if (!resolvedAssetId && slotId && activeVariants) {
      resolvedAssetId = activeVariants.slots.find(
        (slot) => slot.slotId === slotId,
      )?.assetId;
    }
    if (!resolvedAssetId)
      throw new Error("assetId or a ready slotId is required.");
    await markAssetSaved(resolvedAssetId, folderId);
    const asset = await getAssetOrThrow(resolvedAssetId);
    if (activeVariants) {
      activeVariants.slots = activeVariants.slots.filter(
        (slot) => slot.assetId !== resolvedAssetId,
      );
      if (activeVariants.slots.length) {
        await writeAppState(
          "asset-variants",
          activeVariants as unknown as Record<string, unknown>,
        );
        await deleteAppState("image-variants").catch(() => {});
      } else {
        await deleteAppState("asset-variants");
        await deleteAppState("image-variants").catch(() => {});
      }
    }
    return serializeAsset({ ...asset, status: "saved" });
  },
});

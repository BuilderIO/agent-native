import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  deleteAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { markAssetSaved } from "../server/handlers/assets.js";
import { getAssetOrThrow, serializeAsset } from "./_helpers.js";
import type { ImageVariantState } from "../shared/api.js";

export default defineAction({
  description:
    "Save a generated candidate to the library. Accepts an assetId directly or a variant slot ID from application_state.image-variants.",
  schema: z.object({
    assetId: z.string().optional(),
    slotId: z.string().optional(),
  }),
  run: async ({ assetId, slotId }) => {
    let resolvedAssetId = assetId;
    const raw = (await readAppState("image-variants")) as unknown | null;
    const variants = (raw ?? null) as ImageVariantState | null;
    if (!resolvedAssetId && slotId && variants) {
      resolvedAssetId = variants.slots.find(
        (slot) => slot.slotId === slotId,
      )?.assetId;
    }
    if (!resolvedAssetId)
      throw new Error("assetId or a ready slotId is required.");
    await markAssetSaved(resolvedAssetId);
    const asset = await getAssetOrThrow(resolvedAssetId);
    if (variants) {
      variants.slots = variants.slots.filter(
        (slot) => slot.assetId !== resolvedAssetId,
      );
      if (variants.slots.length) {
        await writeAppState(
          "image-variants",
          variants as unknown as Record<string, unknown>,
        );
      } else {
        await deleteAppState("image-variants");
      }
    }
    return serializeAsset({ ...asset, status: "saved" });
  },
});

import { defineAction } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  deleteAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";

import { markAssetSaved } from "../server/handlers/assets.js";
import { getAssetOrThrow, serializeAsset } from "./_helpers.js";
import {
  deleteVariantState,
  readVariantState,
  writeVariantState,
} from "./variant-slots.js";

export default defineAction({
  description:
    "Save a generated asset candidate to the library. Accepts an assetId directly or a variant slot ID from the current thread's application_state.asset-variants.",
  schema: z.object({
    assetId: z.string().optional(),
    slotId: z.string().optional(),
    folderId: z.string().min(1).nullable().optional(),
    threadId: z.string().nullable().optional(),
  }),
  run: async (
    { assetId, slotId, folderId, threadId },
    context?: ActionRunContext,
  ) => {
    const effectiveThreadId = threadId ?? context?.threadId ?? null;
    let resolvedAssetId = assetId;
    const activeVariants = await readVariantState(effectiveThreadId);
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
      const stateThreadId =
        effectiveThreadId ??
        activeVariants.variantScopeId ??
        activeVariants.threadId ??
        null;
      activeVariants.slots = activeVariants.slots.filter(
        (slot) => slot.assetId !== resolvedAssetId,
      );
      if (activeVariants.slots.length) {
        await writeVariantState(activeVariants, stateThreadId);
      } else {
        await deleteVariantState(stateThreadId);
      }
    }
    return serializeAsset({ ...asset, status: "saved" });
  },
});

import { defineAction } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import { IMAGE_MODELS, IMAGE_QUALITY_TIERS } from "../shared/api.js";
import { getAssetOrThrow } from "./_helpers.js";
import generateImage from "./generate-image.js";
import { resolveLiveBatchContinuation } from "./variant-slots.js";

export default defineAction({
  description:
    "Apply a source-guided full-image edit to an existing image. Use for small revisions; true masked/inpaint edits depend on provider support and are not assumed.",
  schema: z.object({
    assetId: z.string(),
    instruction: z.string().min(1),
    model: z.enum(IMAGE_MODELS).optional(),
    tier: z.enum(IMAGE_QUALITY_TIERS).optional(),
    slotId: z.string().optional(),
    source: z.enum(["chat", "ui", "a2a"]).default("chat"),
    callerAppId: z
      .string()
      .optional()
      .describe(
        "Set by A2A callers (e.g. 'slides', 'design') so audit logs can filter by app.",
      ),
    contextModeOverride: z.literal("off").optional(),
  }),
  parallelSafe: true,
  run: async (args, context?: ActionRunContext) => {
    const asset = await getAssetOrThrow(args.assetId);
    const continuation = await resolveLiveBatchContinuation({
      threadId: context?.threadId,
      libraryId: asset.libraryId,
    });
    return generateImage.run(
      {
        libraryId: asset.libraryId,
        collectionId:
          asset.collectionId ?? continuation?.collectionId ?? undefined,
        presetId: continuation?.presetId ?? undefined,
        sessionId: continuation?.sessionId ?? undefined,
        prompt: args.instruction,
        aspectRatio: (asset.aspectRatio ?? "16:9") as any,
        imageSize: (asset.imageSize ?? "2K") as any,
        model: args.model,
        tier: args.tier,
        intent: "edit",
        styleStrength: "balanced",
        referenceAssetIds: [],
        includeLogo: false,
        groundingMode: "off",
        subjectAssetId: asset.id,
        slotId: args.slotId,
        variantBatchId: continuation?.variantBatchId,
        source: args.source,
        callerAppId: args.callerAppId,
        contextModeOverride: args.contextModeOverride,
      },
      context,
    );
  },
});

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import generateImage from "./generate-image.js";
import { getAssetOrThrow } from "./_helpers.js";
import { IMAGE_MODELS, IMAGE_QUALITY_TIERS } from "../shared/api.js";

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
  }),
  parallelSafe: true,
  run: async (args) => {
    const asset = await getAssetOrThrow(args.assetId);
    return generateImage.run({
      libraryId: asset.libraryId,
      collectionId: asset.collectionId ?? undefined,
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
      source: args.source,
      callerAppId: args.callerAppId,
    });
  },
});

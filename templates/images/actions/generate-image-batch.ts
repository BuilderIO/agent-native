import { defineAction } from "@agent-native/core";
import { z } from "zod";
import pLimit from "p-limit";
import generateImage from "./generate-image.js";
import {
  ASPECT_RATIOS,
  IMAGE_CATEGORIES,
  IMAGE_MODELS,
  IMAGE_SIZES,
} from "../shared/api.js";

export default defineAction({
  description:
    "Generate several brand-consistent images in parallel from one library. Use this for slide decks, landing pages, and multi-slot design work. Each returned image includes assetId, runId, previewUrl, downloadUrl, and embedPath.",
  schema: z.object({
    libraryId: z.string(),
    collectionId: z.string().optional(),
    slots: z
      .array(
        z.object({
          slotId: z.string(),
          prompt: z.string().min(1),
          aspectRatio: z.enum(ASPECT_RATIOS).optional(),
          imageSize: z.enum(IMAGE_SIZES).optional(),
          categories: z.array(z.enum(IMAGE_CATEGORIES)).optional(),
          sourceAssetId: z.string().optional(),
        }),
      )
      .min(1)
      .max(12),
    model: z.enum(IMAGE_MODELS).default("gemini-3.1-flash-image-preview"),
    includeLogo: z.coerce.boolean().default(false),
    groundingMode: z.enum(["auto", "off", "google-search"]).default("auto"),
    source: z.enum(["chat", "ui", "a2a"]).default("chat"),
    callerAppId: z
      .string()
      .optional()
      .describe(
        "Set by A2A callers (e.g. 'slides', 'design') so audit logs can filter by app.",
      ),
  }),
  parallelSafe: true,
  run: async ({ slots, ...base }) => {
    const limit = pLimit(4);
    const results = await Promise.allSettled(
      slots.map((slot) =>
        limit(() =>
          generateImage.run({
            libraryId: base.libraryId,
            collectionId: base.collectionId,
            prompt: slot.prompt,
            aspectRatio: slot.aspectRatio ?? "16:9",
            imageSize: slot.imageSize ?? "2K",
            model: base.model,
            categories: slot.categories,
            includeLogo: base.includeLogo,
            groundingMode: base.groundingMode,
            slotId: slot.slotId,
            sourceAssetId: slot.sourceAssetId,
            source: base.source,
            callerAppId: base.callerAppId,
          }),
        ),
      ),
    );
    return {
      count: results.length,
      images: results.map((result, index) =>
        result.status === "fulfilled"
          ? { slotId: slots[index].slotId, ok: true, ...result.value }
          : {
              slotId: slots[index].slotId,
              ok: false,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : "Image generation failed",
            },
      ),
    };
  },
});

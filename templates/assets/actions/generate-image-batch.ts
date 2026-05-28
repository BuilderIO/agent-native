import { defineAction } from "@agent-native/core";
import { z } from "zod";
import pLimit from "p-limit";
import { assertAccess } from "@agent-native/core/sharing";
import generateImage from "./generate-image.js";
import { requireGenerationSessionInLibrary } from "./_helpers.js";
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
    presetId: z.string().optional(),
    sessionId: z.string().optional(),
    slots: z
      .array(
        z.object({
          slotId: z.string(),
          prompt: z.string().min(1),
          aspectRatio: z.enum(ASPECT_RATIOS).optional(),
          imageSize: z.enum(IMAGE_SIZES).optional(),
          categories: z.array(z.enum(IMAGE_CATEGORIES)).optional(),
          referenceAssetIds: z.array(z.string()).optional(),
          sourceAssetId: z.string().optional(),
        }),
      )
      .min(1)
      .max(12),
    model: z.enum(IMAGE_MODELS).optional(),
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
    await assertAccess("asset-library", base.libraryId, "editor");
    if (base.sessionId) {
      await requireGenerationSessionInLibrary(base.sessionId, base.libraryId);
    }
    const limit = pLimit(4);
    const results = await Promise.allSettled(
      slots.map((slot) =>
        limit(() =>
          generateImage.run({
            libraryId: base.libraryId,
            collectionId: base.collectionId,
            presetId: base.presetId,
            sessionId: base.sessionId,
            prompt: slot.prompt,
            aspectRatio: slot.aspectRatio,
            imageSize: slot.imageSize,
            model: base.model,
            categories: slot.categories,
            referenceAssetIds: slot.referenceAssetIds,
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

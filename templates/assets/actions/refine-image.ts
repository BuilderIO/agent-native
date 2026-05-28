import { defineAction } from "@agent-native/core";
import { z } from "zod";
import generateImage from "./generate-image.js";
import {
  getAssetOrThrow,
  requireGenerationSessionInLibrary,
} from "./_helpers.js";
import { parseJson } from "../server/lib/json.js";
import { ASPECT_RATIOS, IMAGE_MODELS, IMAGE_SIZES } from "../shared/api.js";

export default defineAction({
  description:
    "Refine a generated image by assetId using feedback. Preserves lineage by using the prior image as a reference and linking the new candidate to the source asset.",
  schema: z.object({
    assetId: z.string(),
    feedback: z.string().min(1),
    presetId: z.string().optional(),
    sessionId: z.string().optional(),
    model: z.enum(IMAGE_MODELS).optional(),
    aspectRatio: z.enum(ASPECT_RATIOS).optional(),
    imageSize: z.enum(IMAGE_SIZES).optional(),
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
  run: async ({
    assetId,
    feedback,
    presetId,
    sessionId,
    model,
    aspectRatio,
    imageSize,
    slotId,
    source,
    callerAppId,
  }) => {
    const asset = await getAssetOrThrow(assetId);
    if (sessionId) {
      await requireGenerationSessionInLibrary(sessionId, asset.libraryId);
    }
    const metadata = parseJson<{ category?: any }>(asset.metadata, {});
    const prompt = [
      asset.prompt || "Refine the prior generated image.",
      "",
      "User feedback:",
      feedback,
      "",
      "Preserve the strongest successful parts of the prior candidate unless the feedback contradicts them.",
    ].join("\n");
    return generateImage.run({
      libraryId: asset.libraryId,
      collectionId: asset.collectionId ?? undefined,
      presetId,
      sessionId,
      prompt,
      aspectRatio: (aspectRatio ?? asset.aspectRatio ?? "16:9") as any,
      imageSize: (imageSize ?? asset.imageSize ?? "2K") as any,
      model: (model ?? asset.model ?? "gemini-3.1-flash-image") as any,
      categories: metadata.category ? [metadata.category] : undefined,
      includeLogo: false,
      groundingMode: "auto",
      sourceAssetId: asset.id,
      slotId,
      source,
      callerAppId,
    });
  },
});

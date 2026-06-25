import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  ASPECT_RATIOS,
  IMAGE_MODELS,
  IMAGE_QUALITY_TIERS,
  IMAGE_SIZES,
  STYLE_STRENGTHS,
} from "../shared/api.js";
import { getAssetOrThrow } from "./_helpers.js";
import generateImage from "./generate-image.js";

export default defineAction({
  description:
    "Restyle an existing image with its library's brand look. Preserves the subject image while using the library's deterministic style anchors and references.",
  schema: z.object({
    subjectAssetId: z.string(),
    prompt: z
      .string()
      .optional()
      .describe("Optional additional direction for the restyled output."),
    styleStrength: z.enum(STYLE_STRENGTHS).default("balanced"),
    presetId: z.string().optional(),
    sessionId: z.string().optional(),
    model: z.enum(IMAGE_MODELS).optional(),
    tier: z.enum(IMAGE_QUALITY_TIERS).optional(),
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
  run: async (args) => {
    const subject = await getAssetOrThrow(args.subjectAssetId);
    const prompt =
      args.prompt?.trim() ||
      "Apply this library's brand style to the subject image while preserving the subject, pose, composition, and framing.";
    return generateImage.run({
      libraryId: subject.libraryId,
      collectionId: subject.collectionId ?? undefined,
      presetId: args.presetId,
      sessionId: args.sessionId,
      prompt,
      aspectRatio: (args.aspectRatio ?? subject.aspectRatio ?? "16:9") as any,
      imageSize: (args.imageSize ?? subject.imageSize ?? "2K") as any,
      model: args.model,
      tier: args.tier,
      intent: "restyle",
      styleStrength: args.styleStrength,
      includeLogo: false,
      groundingMode: "auto",
      subjectAssetId: subject.id,
      slotId: args.slotId,
      source: args.source,
      callerAppId: args.callerAppId,
    });
  },
});

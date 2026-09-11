import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  ASPECT_RATIOS,
  GENERATION_PRESET_REFERENCE_POLICIES,
  IMAGE_CATEGORIES,
  IMAGE_MODELS,
  IMAGE_SIZES,
} from "../shared/api.js";
import { generationPresetSettingsSchema } from "./_generation-preset-settings.js";
import createTemplate from "./create-template.js";

export default defineAction({
  description:
    "Deprecated — use create-template. Create a reusable deliverable preset for an asset library.",
  schema: z.object({
    libraryId: z.string(),
    collectionId: z.string().nullable().optional(),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    category: z.enum(IMAGE_CATEGORIES).default("style-only"),
    promptTemplate: z.string().nullable().optional(),
    aspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
    imageSize: z.enum(IMAGE_SIZES).default("2K"),
    model: z.enum(IMAGE_MODELS).default("gemini-3.1-flash-image"),
    textPolicy: z.string().default(""),
    referencePolicy: z
      .enum(GENERATION_PRESET_REFERENCE_POLICIES)
      .default("auto"),
    includeLogo: z.coerce
      .boolean()
      .optional()
      .describe(
        "When true, images generated with this preset composite the library's canonical logo (no-op if the library has no canonical logo).",
      ),
    settings: generationPresetSettingsSchema.optional(),
    sortOrder: z.coerce.number().optional(),
  }),
  run: async (args) => createTemplate.run(args),
});

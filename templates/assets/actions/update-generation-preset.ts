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
import updateTemplate from "./update-template.js";

export default defineAction({
  description: "Deprecated — use update-template. Update a generation preset.",
  schema: z.object({
    id: z.string(),
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    collectionId: z.string().nullable().optional(),
    category: z.enum(IMAGE_CATEGORIES).optional(),
    promptTemplate: z.string().nullable().optional(),
    aspectRatio: z.enum(ASPECT_RATIOS).optional(),
    imageSize: z.enum(IMAGE_SIZES).optional(),
    model: z.enum(IMAGE_MODELS).optional(),
    textPolicy: z.string().optional(),
    referencePolicy: z.enum(GENERATION_PRESET_REFERENCE_POLICIES).optional(),
    includeLogo: z.coerce.boolean().optional(),
    settings: generationPresetSettingsSchema.optional(),
    sortOrder: z.coerce.number().optional(),
  }),
  run: async (args) => updateTemplate.run(args),
});

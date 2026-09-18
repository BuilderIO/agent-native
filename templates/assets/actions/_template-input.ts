import { z } from "zod";

import {
  ASPECT_RATIOS,
  GENERATION_PRESET_REFERENCE_POLICIES,
  IMAGE_CATEGORIES,
  IMAGE_MODELS,
  IMAGE_SIZES,
} from "../shared/api.js";
import { generationPresetSettingsSchema } from "./_generation-preset-settings.js";

export const templateFieldsSchema = z.object({
  libraryId: z.string().nullable().optional(),
  collectionId: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
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
});

export function templateHasPins(settings: Record<string, unknown>) {
  const refs = Array.isArray(settings.presetReferences)
    ? settings.presetReferences
    : [];
  const pinned = refs.flatMap((reference) => {
    if (!reference || typeof reference !== "object") return [];
    const entry = reference as {
      id?: unknown;
      label?: unknown;
      assetIds?: unknown;
    };
    if (!Array.isArray(entry.assetIds) || !entry.assetIds.length) return [];
    const name =
      typeof entry.label === "string" && entry.label.trim()
        ? entry.label.trim()
        : typeof entry.id === "string" && entry.id
          ? entry.id
          : "unnamed reference";
    return [`reference \"${name}\"`];
  });
  const skeleton = settings.skeletonSpec ? ["skeletonSpec"] : [];
  return [...pinned, ...skeleton];
}

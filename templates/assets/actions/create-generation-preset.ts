import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, stringifyJson } from "../server/lib/json.js";
import {
  ASPECT_RATIOS,
  GENERATION_PRESET_REFERENCE_POLICIES,
  IMAGE_CATEGORIES,
  IMAGE_MODELS,
  IMAGE_SIZES,
} from "../shared/api.js";
import { generationPresetSettingsSchema } from "./_generation-preset-settings.js";
import { serializeGenerationPreset } from "./_helpers.js";
import { assertPresetSkeletonAssetsValid } from "./_preset-skeleton-validation.js";

export default defineAction({
  description:
    "Create a reusable deliverable preset for an asset library. Use presets for social images, blog heroes, diagrams, and other repeatable output formats.",
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
  run: async (args) => {
    const db = getDb();
    await assertAccess("asset-library", args.libraryId, "editor");
    if (args.collectionId) {
      const [collection] = await db
        .select()
        .from(schema.assetCollections)
        .where(eq(schema.assetCollections.id, args.collectionId))
        .limit(1);
      if (!collection || collection.libraryId !== args.libraryId) {
        throw new Error("Collection does not belong to this asset library.");
      }
    }
    await assertPresetSkeletonAssetsValid({
      db,
      libraryId: args.libraryId,
      settings: args.settings,
    });
    const now = nowIso();
    const row = {
      id: nanoid(),
      libraryId: args.libraryId,
      collectionId: args.collectionId ?? null,
      title: args.title,
      description: args.description ?? null,
      category: args.category,
      mediaType: "image",
      promptTemplate: args.promptTemplate ?? null,
      aspectRatio: args.aspectRatio,
      imageSize: args.imageSize,
      model: args.model,
      textPolicy: args.textPolicy,
      referencePolicy: args.referencePolicy,
      settings: stringifyJson({
        ...(args.settings ?? {}),
        ...(args.includeLogo !== undefined
          ? { includeLogo: args.includeLogo }
          : {}),
      }),
      sortOrder: args.sortOrder ?? 100,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(schema.assetGenerationPresets).values(row);
    return serializeGenerationPreset(row);
  },
});

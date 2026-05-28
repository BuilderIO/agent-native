import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { nowIso, stringifyJson } from "../server/lib/json.js";
import { serializeGenerationPreset } from "./_helpers.js";
import {
  ASPECT_RATIOS,
  GENERATION_PRESET_REFERENCE_POLICIES,
  IMAGE_CATEGORIES,
  IMAGE_MODELS,
  IMAGE_SIZES,
} from "../shared/api.js";

export default defineAction({
  description:
    "Update a generation preset's deliverable rules, defaults, or prompt template.",
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
    settings: z.record(z.string(), z.unknown()).optional(),
    sortOrder: z.coerce.number().optional(),
  }),
  run: async ({ id, ...args }) => {
    const db = getDb();
    const [preset] = await db
      .select()
      .from(schema.assetGenerationPresets)
      .where(eq(schema.assetGenerationPresets.id, id))
      .limit(1);
    if (!preset) throw new Error("Generation preset not found.");
    await assertAccess("asset-library", preset.libraryId, "editor");
    if (args.collectionId) {
      const [collection] = await db
        .select()
        .from(schema.assetCollections)
        .where(eq(schema.assetCollections.id, args.collectionId))
        .limit(1);
      if (!collection || collection.libraryId !== preset.libraryId) {
        throw new Error("Collection does not belong to this asset library.");
      }
    }
    const updates: Record<string, unknown> = { updatedAt: nowIso() };
    for (const key of [
      "title",
      "description",
      "collectionId",
      "category",
      "promptTemplate",
      "aspectRatio",
      "imageSize",
      "model",
      "textPolicy",
      "referencePolicy",
      "sortOrder",
    ] as const) {
      if (args[key] !== undefined) updates[key] = args[key];
    }
    if (args.settings !== undefined) {
      updates.settings = stringifyJson(args.settings);
    }
    await db
      .update(schema.assetGenerationPresets)
      .set(updates)
      .where(eq(schema.assetGenerationPresets.id, id));
    return serializeGenerationPreset({ ...preset, ...updates });
  },
});

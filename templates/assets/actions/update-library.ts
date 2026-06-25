import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import { ASPECT_RATIOS, IMAGE_MODELS, IMAGE_SIZES } from "../shared/api.js";

async function assertAssetBelongsToLibrary(
  assetId: string,
  libraryId: string,
  label: string,
) {
  const [asset] = await getDb()
    .select({ id: schema.assets.id, libraryId: schema.assets.libraryId })
    .from(schema.assets)
    .where(eq(schema.assets.id, assetId))
    .limit(1);
  if (!asset || asset.libraryId !== libraryId) {
    throw new Error(`${label} must belong to this asset library.`);
  }
}

export default defineAction({
  description:
    "Update an asset library's title, description, custom instructions, style brief, model defaults, cover, or canonical logo.",
  schema: z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    customInstructions: z.string().nullable().optional(),
    styleBrief: z.record(z.string(), z.unknown()).optional(),
    settings: z
      .object({
        defaultModel: z.enum(IMAGE_MODELS).optional(),
        defaultAspectRatio: z.enum(ASPECT_RATIOS).optional(),
        defaultImageSize: z.enum(IMAGE_SIZES).optional(),
        canonicalStyleAssetIds: z.array(z.string()).optional(),
        brandAnalysis: z.record(z.string(), z.unknown()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    coverAssetId: z.string().nullable().optional(),
    canonicalLogoAssetId: z.string().nullable().optional(),
  }),
  run: async ({
    id,
    title,
    description,
    styleBrief,
    customInstructions,
    settings,
    coverAssetId,
    canonicalLogoAssetId,
  }) => {
    await assertAccess("asset-library", id, "editor");
    const updates: Record<string, unknown> = { updatedAt: nowIso() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (customInstructions !== undefined) {
      updates.customInstructions = customInstructions ?? "";
    }
    if (styleBrief !== undefined)
      updates.styleBrief = stringifyJson(styleBrief);
    if (settings !== undefined) {
      const [library] = await getDb()
        .select({ settings: schema.assetLibraries.settings })
        .from(schema.assetLibraries)
        .where(eq(schema.assetLibraries.id, id))
        .limit(1);
      const previousSettings = parseJson<Record<string, unknown>>(
        library?.settings,
        {},
      );
      updates.settings = stringifyJson({ ...previousSettings, ...settings });
    }
    if (coverAssetId !== undefined) {
      if (coverAssetId) {
        await assertAssetBelongsToLibrary(coverAssetId, id, "Cover asset");
      }
      updates.coverAssetId = coverAssetId;
    }
    if (canonicalLogoAssetId !== undefined) {
      if (canonicalLogoAssetId) {
        await assertAssetBelongsToLibrary(
          canonicalLogoAssetId,
          id,
          "Canonical logo asset",
        );
      }
      updates.canonicalLogoAssetId = canonicalLogoAssetId;
    }
    await getDb()
      .update(schema.assetLibraries)
      .set(updates)
      .where(eq(schema.assetLibraries.id, id));
    return { id, updated: true };
  },
});

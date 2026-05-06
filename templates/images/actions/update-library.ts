import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { nowIso, stringifyJson } from "../server/lib/json.js";
import { ASPECT_RATIOS, IMAGE_MODELS, IMAGE_SIZES } from "../shared/api.js";

export default defineAction({
  description:
    "Update an image library's title, description, style brief, model defaults, cover, or canonical logo.",
  schema: z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    styleBrief: z.record(z.string(), z.unknown()).optional(),
    settings: z
      .object({
        defaultModel: z.enum(IMAGE_MODELS).optional(),
        defaultAspectRatio: z.enum(ASPECT_RATIOS).optional(),
        defaultImageSize: z.enum(IMAGE_SIZES).optional(),
      })
      .optional(),
    coverAssetId: z.string().nullable().optional(),
    canonicalLogoAssetId: z.string().nullable().optional(),
  }),
  run: async ({
    id,
    title,
    description,
    styleBrief,
    settings,
    coverAssetId,
    canonicalLogoAssetId,
  }) => {
    await assertAccess("image-library", id, "editor");
    const updates: Record<string, unknown> = { updatedAt: nowIso() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (styleBrief !== undefined)
      updates.styleBrief = stringifyJson(styleBrief);
    if (settings !== undefined) updates.settings = stringifyJson(settings);
    if (coverAssetId !== undefined) updates.coverAssetId = coverAssetId;
    if (canonicalLogoAssetId !== undefined) {
      updates.canonicalLogoAssetId = canonicalLogoAssetId;
    }
    await getDb()
      .update(schema.imageLibraries)
      .set(updates)
      .where(eq(schema.imageLibraries.id, id));
    return { id, updated: true };
  },
});

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { nowIso, stringifyJson } from "../server/lib/json.js";
import { ASPECT_RATIOS, IMAGE_CATEGORIES, IMAGE_SIZES } from "../shared/api.js";

export default defineAction({
  description: "Update an image collection's details and defaults.",
  schema: z.object({
    id: z.string(),
    libraryId: z.string(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    category: z.enum(IMAGE_CATEGORIES).optional(),
    defaultAspectRatio: z.enum(ASPECT_RATIOS).optional(),
    defaultImageSize: z.enum(IMAGE_SIZES).optional(),
    styleBrief: z.record(z.string(), z.unknown()).optional(),
  }),
  run: async ({ id, libraryId, ...args }) => {
    await assertAccess("image-library", libraryId, "editor");
    const updates: Record<string, unknown> = { updatedAt: nowIso() };
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.category !== undefined) updates.category = args.category;
    if (args.defaultAspectRatio !== undefined) {
      updates.defaultAspectRatio = args.defaultAspectRatio;
    }
    if (args.defaultImageSize !== undefined) {
      updates.defaultImageSize = args.defaultImageSize;
    }
    if (args.styleBrief !== undefined) {
      updates.styleBrief = stringifyJson(args.styleBrief);
    }
    await getDb()
      .update(schema.imageCollections)
      .set(updates)
      .where(eq(schema.imageCollections.id, id));
    return { id, updated: true };
  },
});

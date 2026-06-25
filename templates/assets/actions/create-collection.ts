import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, stringifyJson } from "../server/lib/json.js";
import { ASPECT_RATIOS, IMAGE_CATEGORIES, IMAGE_SIZES } from "../shared/api.js";

export default defineAction({
  description:
    "Create a category-specific collection inside an asset library, such as blog heroes, diagrams, product shots, or landing page images.",
  schema: z.object({
    libraryId: z.string(),
    title: z.string().min(1),
    description: z.string().optional(),
    category: z.enum(IMAGE_CATEGORIES).default("style-only"),
    defaultAspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
    defaultImageSize: z.enum(IMAGE_SIZES).default("2K"),
    styleBrief: z.record(z.string(), z.unknown()).optional(),
  }),
  run: async (args) => {
    await assertAccess("asset-library", args.libraryId, "editor");
    const now = nowIso();
    const row = {
      id: nanoid(),
      libraryId: args.libraryId,
      title: args.title,
      description: args.description ?? null,
      category: args.category,
      styleBrief: stringifyJson(args.styleBrief ?? {}),
      defaultAspectRatio: args.defaultAspectRatio,
      defaultImageSize: args.defaultImageSize,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().insert(schema.assetCollections).values(row);
    return row;
  },
});

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import { getAssetOrThrow, serializeAsset } from "./_helpers.js";
import { IMAGE_CATEGORIES } from "../shared/api.js";

export default defineAction({
  description:
    "Update image asset metadata, category, role, status, title, or alt text. Use this to save candidates to a library or mark uploaded logos/products.",
  schema: z.object({
    id: z.string(),
    title: z.string().nullable().optional(),
    altText: z.string().nullable().optional(),
    status: z
      .enum(["reference", "candidate", "saved", "archived", "failed"])
      .optional(),
    role: z
      .enum([
        "style_reference",
        "logo_reference",
        "product_reference",
        "diagram_reference",
        "generated",
      ])
      .optional(),
    category: z.enum(IMAGE_CATEGORIES).optional(),
  }),
  run: async ({ id, category, ...args }) => {
    const asset = await getAssetOrThrow(id);
    await assertAccess("image-library", asset.libraryId, "editor");
    const metadata = parseJson<Record<string, unknown>>(asset.metadata, {});
    if (category !== undefined) metadata.category = category;
    const updates: Record<string, unknown> = {
      updatedAt: nowIso(),
      metadata: stringifyJson(metadata),
    };
    if (args.title !== undefined) updates.title = args.title;
    if (args.altText !== undefined) updates.altText = args.altText;
    if (args.status !== undefined) updates.status = args.status;
    if (args.role !== undefined) updates.role = args.role;
    await getDb()
      .update(schema.imageAssets)
      .set(updates)
      .where(eq(schema.imageAssets.id, id));
    return serializeAsset({ ...asset, ...updates });
  },
});

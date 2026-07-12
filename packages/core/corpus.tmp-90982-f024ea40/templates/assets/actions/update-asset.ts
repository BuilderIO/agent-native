import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import { IMAGE_CATEGORIES } from "../shared/api.js";
import { getAssetOrThrow, serializeAsset } from "./_helpers.js";

export default defineAction({
  description:
    "Update asset metadata, folder, category, role, status, title, description, or alt text. Use this to organize DAM assets and save generated candidates.",
  schema: z.object({
    id: z.string(),
    folderId: z.string().min(1).nullable().optional(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
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
        "video_reference",
        "background_reference",
        "subject_reference",
        "edit_target",
        "generated",
      ])
      .optional(),
    category: z.enum(IMAGE_CATEGORIES).optional(),
    isStyleAnchor: z.coerce
      .boolean()
      .optional()
      .describe("Marks this reference as a stable brand/style anchor."),
  }),
  run: async ({ id, category, isStyleAnchor, ...args }) => {
    const asset = await getAssetOrThrow(id);
    await assertAccess("asset-library", asset.libraryId, "editor");
    if (args.folderId !== undefined && args.folderId !== null) {
      const [folder] = await getDb()
        .select()
        .from(schema.assetFolders)
        .where(eq(schema.assetFolders.id, args.folderId))
        .limit(1);
      if (!folder || folder.libraryId !== asset.libraryId) {
        throw new Error("Folder does not belong to this asset library.");
      }
    }
    const metadata = parseJson<Record<string, unknown>>(asset.metadata, {});
    if (category !== undefined) metadata.category = category;
    if (isStyleAnchor !== undefined) metadata.isStyleAnchor = isStyleAnchor;
    const updates: Record<string, unknown> = {
      updatedAt: nowIso(),
      metadata: stringifyJson(metadata),
    };
    if (args.folderId !== undefined) updates.folderId = args.folderId;
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) {
      updates.description = args.description;
      if (args.description) metadata.description = args.description;
      else delete metadata.description;
      updates.metadata = stringifyJson(metadata);
    }
    if (args.altText !== undefined) updates.altText = args.altText;
    if (args.status !== undefined) updates.status = args.status;
    if (args.role !== undefined) updates.role = args.role;
    await getDb()
      .update(schema.assets)
      .set(updates)
      .where(eq(schema.assets.id, id));
    return serializeAsset({ ...asset, ...updates });
  },
});

import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { nowIso } from "../server/lib/json.js";

export default defineAction({
  description:
    "Rename, describe, reorder, or move a folder in an asset library.",
  schema: z.object({
    id: z.string(),
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    parentId: z.string().nullable().optional(),
    sortOrder: z.coerce.number().int().optional(),
  }),
  run: async ({ id, ...args }) => {
    const db = getDb();
    const [folder] = await db
      .select()
      .from(schema.assetFolders)
      .where(eq(schema.assetFolders.id, id))
      .limit(1);
    if (!folder) throw new Error("Folder not found.");
    await assertAccess("asset-library", folder.libraryId, "editor");
    if (args.parentId) {
      if (args.parentId === id) {
        throw new Error("A folder cannot be moved into itself.");
      }
      const [parent] = await db
        .select()
        .from(schema.assetFolders)
        .where(eq(schema.assetFolders.id, args.parentId))
        .limit(1);
      if (!parent || parent.libraryId !== folder.libraryId) {
        throw new Error("Parent folder does not belong to this library.");
      }
    }
    const updates: Record<string, unknown> = { updatedAt: nowIso() };
    if (args.title !== undefined) updates.title = args.title.trim();
    if (args.description !== undefined) {
      updates.description = args.description?.trim() || null;
    }
    if (args.parentId !== undefined) updates.parentId = args.parentId;
    if (args.sortOrder !== undefined) updates.sortOrder = args.sortOrder;
    await db
      .update(schema.assetFolders)
      .set(updates)
      .where(eq(schema.assetFolders.id, id));
    return { ...folder, ...updates };
  },
});

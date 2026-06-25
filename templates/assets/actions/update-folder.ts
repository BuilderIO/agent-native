import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso } from "../server/lib/json.js";

async function assertParentIsNotDescendant(
  db: ReturnType<typeof getDb>,
  folderId: string,
  parent: typeof schema.assetFolders.$inferSelect,
) {
  const seen = new Set<string>([parent.id]);
  let cursor = parent;
  while (cursor.parentId) {
    if (cursor.parentId === folderId) {
      throw new Error("A folder cannot be moved into one of its children.");
    }
    if (seen.has(cursor.parentId)) {
      throw new Error("Parent folder hierarchy is already circular.");
    }
    seen.add(cursor.parentId);
    const [nextParent] = await db
      .select()
      .from(schema.assetFolders)
      .where(eq(schema.assetFolders.id, cursor.parentId))
      .limit(1);
    if (!nextParent || nextParent.libraryId !== parent.libraryId) {
      throw new Error("Parent folder hierarchy is invalid.");
    }
    cursor = nextParent;
  }
}

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
      await assertParentIsNotDescendant(db, id, parent);
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

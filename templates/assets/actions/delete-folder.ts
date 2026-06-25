import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso } from "../server/lib/json.js";

async function assertDestinationIsNotDescendant(
  db: ReturnType<typeof getDb>,
  folderId: string,
  destination: typeof schema.assetFolders.$inferSelect,
) {
  const seen = new Set<string>([destination.id]);
  let cursor = destination;
  while (cursor.parentId) {
    if (cursor.parentId === folderId) {
      throw new Error(
        "A folder cannot move contents into one of its children.",
      );
    }
    if (seen.has(cursor.parentId)) {
      throw new Error("Destination folder hierarchy is already circular.");
    }
    seen.add(cursor.parentId);
    const [parent] = await db
      .select()
      .from(schema.assetFolders)
      .where(eq(schema.assetFolders.id, cursor.parentId))
      .limit(1);
    if (!parent || parent.libraryId !== destination.libraryId) {
      throw new Error("Destination folder hierarchy is invalid.");
    }
    cursor = parent;
  }
}

export default defineAction({
  description:
    "Delete a folder from an asset library. Assets and child folders are moved to the deleted folder's parent or to a provided destination folder.",
  schema: z.object({
    id: z.string(),
    moveToFolderId: z.string().nullable().optional(),
  }),
  run: async ({ id, moveToFolderId }) => {
    const db = getDb();
    const [folder] = await db
      .select()
      .from(schema.assetFolders)
      .where(eq(schema.assetFolders.id, id))
      .limit(1);
    if (!folder) throw new Error("Folder not found.");
    await assertAccess("asset-library", folder.libraryId, "editor");
    const destinationId =
      moveToFolderId === undefined ? folder.parentId : moveToFolderId;
    if (destinationId) {
      if (destinationId === id) {
        throw new Error("A folder cannot move assets into itself.");
      }
      const [destination] = await db
        .select()
        .from(schema.assetFolders)
        .where(eq(schema.assetFolders.id, destinationId))
        .limit(1);
      if (!destination || destination.libraryId !== folder.libraryId) {
        throw new Error("Destination folder does not belong to this library.");
      }
      await assertDestinationIsNotDescendant(db, id, destination);
    }
    const now = nowIso();
    await db
      .update(schema.assets)
      .set({ folderId: destinationId ?? null, updatedAt: now })
      .where(eq(schema.assets.folderId, id));
    await db
      .update(schema.assetFolders)
      .set({ parentId: destinationId ?? null, updatedAt: now })
      .where(eq(schema.assetFolders.parentId, id));
    await db.delete(schema.assetFolders).where(eq(schema.assetFolders.id, id));
    return { id, deleted: true, movedToFolderId: destinationId ?? null };
  },
});

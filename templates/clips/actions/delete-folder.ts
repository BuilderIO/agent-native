import { defineAction } from "@agent-native/core";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Delete a folder. Recordings inside cascade out to the library root (parent scope) — they are NOT deleted. Nested subfolders also cascade out.",
  schema: z.object({
    id: z.string().min(1).describe("Folder id"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    // Find the folder and gather all descendant folder ids
    const [folder] = await db
      .select()
      .from(schema.folders)
      .where(
        and(
          eq(schema.folders.id, args.id),
          eq(schema.folders.ownerEmail, ownerEmail),
        ),
      );

    if (!folder) {
      throw new Error(`Folder not found: ${args.id}`);
    }

    // BFS for descendants
    const descendants: string[] = [folder.id];
    let frontier: string[] = [folder.id];
    while (frontier.length > 0) {
      const children = await db
        .select({ id: schema.folders.id })
        .from(schema.folders)
        .where(
          and(
            inArray(schema.folders.parentId, frontier),
            eq(schema.folders.ownerEmail, ownerEmail),
          ),
        );
      const nextIds = children.map((c) => c.id);
      descendants.push(...nextIds);
      frontier = nextIds;
    }

    // Cascade recordings out to parent scope (library root OR parent folder)
    // All recordings whose folderId is any descendant bubble up to folder.parentId
    const now = new Date().toISOString();
    await db
      .update(schema.recordings)
      .set({ folderId: folder.parentId ?? null, updatedAt: now })
      .where(inArray(schema.recordings.folderId, descendants));

    // Delete the folders (deepest first is unnecessary since all will go)
    await db
      .delete(schema.folders)
      .where(
        and(
          inArray(schema.folders.id, descendants),
          eq(schema.folders.ownerEmail, ownerEmail),
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: args.id,
      deletedFolderIds: descendants,
      cascadedTo: folder.parentId ?? null,
    };
  },
});

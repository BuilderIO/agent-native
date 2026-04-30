import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Move a composition into a folder, or pass folderId='' (or omit it) to remove the composition from its current folder.",
  schema: z.object({
    compositionId: z.string().describe("Composition id to file"),
    folderId: z
      .string()
      .optional()
      .describe(
        "Target folder id. Empty string or omitted means 'remove from folder'.",
      ),
  }),
  run: async ({ compositionId, folderId }) => {
    const db = getDb();

    await db
      .delete(schema.folderMemberships)
      .where(eq(schema.folderMemberships.compositionId, compositionId));

    if (!folderId) {
      return { compositionId, folderId: null };
    }

    await assertAccess("folder", folderId, "editor");

    await db.insert(schema.folderMemberships).values({
      id: nanoid(),
      folderId,
      compositionId,
      createdAt: new Date().toISOString(),
    });

    return { compositionId, folderId };
  },
});

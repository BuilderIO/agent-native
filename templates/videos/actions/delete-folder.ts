import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete a library folder. Compositions inside the folder are not deleted — they revert to uncategorized.",
  schema: z.object({
    id: z.string().describe("Folder id to delete"),
  }),
  run: async ({ id }) => {
    await assertAccess("folder", id, "admin");

    const db = getDb();

    await db
      .delete(schema.folderMemberships)
      .where(eq(schema.folderMemberships.folderId, id));

    await db.delete(schema.folders).where(eq(schema.folders.id, id));

    return { success: true, id };
  },
});

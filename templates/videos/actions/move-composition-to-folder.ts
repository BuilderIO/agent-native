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

    const compositionAccess = await assertAccess(
      "composition",
      compositionId,
      "editor",
    );

    let folderAccess: Awaited<ReturnType<typeof assertAccess>> | null = null;
    if (folderId) {
      folderAccess = await assertAccess("folder", folderId, "editor");
      if (
        compositionAccess.resource.orgId &&
        folderAccess.resource.orgId &&
        compositionAccess.resource.orgId !== folderAccess.resource.orgId
      ) {
        throw new Error("Composition and folder belong to different orgs");
      }
    }

    await db
      .delete(schema.folderMemberships)
      .where(eq(schema.folderMemberships.compositionId, compositionId));

    if (!folderId || !folderAccess) {
      return { compositionId, folderId: null };
    }

    await db.insert(schema.folderMemberships).values({
      id: nanoid(),
      folderId,
      compositionId,
      createdAt: new Date().toISOString(),
    });

    return { compositionId, folderId };
  },
});

import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formsAccess, formsErrors, nowIso } from "./_access.js";
import { requireFolder } from "./_folders.js";

export default defineAction({
  description:
    "Move a folder to the Trash. Its forms are not deleted: they move to the top level of the workspace. restore-item brings the empty folder back.",
  schema: z.object({ id: z.string().describe("Folder id") }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    await requireFolder(formsAccess(), id);
    const now = nowIso();
    await getDb().transaction(async (tx) => {
      await tx
        .update(schema.forms)
        .set({ folderId: null, updatedAt: now })
        .where(eq(schema.forms.folderId, id));
      await tx
        .update(schema.folders)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(schema.folders.id, id));
    });
    return { id };
  },
});

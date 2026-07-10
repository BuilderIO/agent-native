import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete a saved Design template owned or administered by the user.",
  schema: z.object({ id: z.string().min(1).describe("Saved template ID") }),
  run: async ({ id }) => {
    await assertAccess("design-template", id, "admin");
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.designTemplateShares)
        .where(eq(schema.designTemplateShares.resourceId, id));
      await tx
        .delete(schema.designTemplateFiles)
        .where(eq(schema.designTemplateFiles.templateId, id));
      await tx
        .delete(schema.designTemplates)
        .where(eq(schema.designTemplates.id, id));
    });
    return { id, deleted: true };
  },
});

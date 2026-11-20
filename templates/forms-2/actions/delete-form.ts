import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formsAccess, formsErrors, nowIso, requireForm } from "./_access.js";

export default defineAction({
  description:
    "Move a form to the Trash. Its public link stops working; restore-form brings it back.",
  schema: z.object({ id: z.string().describe("Form id") }),
  outputSchema: z.object({ id: z.string() }),
  errors: formsErrors,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    const access = formsAccess();
    await requireForm(access, id);
    const now = nowIso();
    await getDb()
      .update(schema.forms)
      .set({ status: "deleted", deletedAt: now, updatedAt: now })
      .where(eq(schema.forms.id, id));
    return { id };
  },
});

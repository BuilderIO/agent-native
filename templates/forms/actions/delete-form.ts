import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Delete a form and all its responses.",
  schema: z.object({
    id: z.string().describe("Form ID to delete (required)"),
  }),
  run: async (args) => {
    await assertAccess("form", args.id, "admin");

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, args.id))
      .limit(1);

    if (!existing) {
      throw new Error(`Form ${args.id} not found`);
    }

    // Delete responses first, then form
    await db
      .delete(schema.responses)
      .where(eq(schema.responses.formId, args.id));
    await db.delete(schema.forms).where(eq(schema.forms.id, args.id));

    return { success: true };
  },
});

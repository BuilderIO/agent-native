import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Soft-delete a form: marks it deleted and hides it from the main list. Responses are preserved and visible in the Archive. Pass `--purge` to permanently delete the form and its responses.",
  schema: z.object({
    id: z.string().describe("Form ID to delete (required)"),
    purge: z.coerce
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, permanently delete the form and all responses (cannot be undone). Default false (soft delete).",
      ),
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

    if (args.purge) {
      await db
        .delete(schema.responses)
        .where(eq(schema.responses.formId, args.id));
      await db.delete(schema.forms).where(eq(schema.forms.id, args.id));
      return { success: true, purged: true };
    }

    const now = new Date().toISOString();
    await db
      .update(schema.forms)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(schema.forms.id, args.id));

    return { success: true, purged: false, deletedAt: now };
  },
});

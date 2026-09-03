import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { invalidatePublicFormCache } from "../server/lib/public-form-ssr.js";

export default defineAction({
  description:
    "Soft-delete a form: marks it deleted and hides it from the main list. Responses are preserved and visible in the Archive. Pass `--purge` to permanently delete the form and its responses.",
  schema: z.object({
    id: z
      .union([z.string(), z.array(z.string()).min(1)])
      .describe("Form ID or IDs to delete (required)"),
    purge: z.coerce
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, permanently delete the form and all responses (cannot be undone). Default false (soft delete).",
      ),
  }),
  run: async (args) => {
    const db = getDb();
    const ids = Array.isArray(args.id) ? args.id : [args.id];
    const existingForms: (typeof schema.forms.$inferSelect)[] = [];
    for (const id of ids) {
      await assertAccess("form", id, "admin");
      const [existing] = await db
        .select()
        .from(schema.forms)
        .where(eq(schema.forms.id, id))
        .limit(1);
      if (!existing) throw new Error(`Form ${id} not found`);
      existingForms.push(existing);
    }

    const results: Array<
      | { id: string; success: true; purged: true }
      | { id: string; success: true; purged: false; deletedAt: string }
    > = [];
    await db.transaction(async (tx) => {
      for (const existing of existingForms) {
        const id = existing.id;
        if (args.purge) {
          await tx
            .delete(schema.responses)
            .where(eq(schema.responses.formId, id));
          await tx.delete(schema.forms).where(eq(schema.forms.id, id));
          results.push({ id, success: true, purged: true });
          continue;
        }

        const now = new Date().toISOString();
        await tx
          .update(schema.forms)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(schema.forms.id, id));
        results.push({ id, success: true, purged: false, deletedAt: now });
      }
    });
    for (const existing of existingForms) {
      invalidatePublicFormCache(existing);
    }
    return Array.isArray(args.id) ? { results } : results[0];
  },
});

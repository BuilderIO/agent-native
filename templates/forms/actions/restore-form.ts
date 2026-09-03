import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { invalidatePublicFormCache } from "../server/lib/public-form-ssr.js";

export default defineAction({
  description:
    "Restore a soft-deleted form. The form returns to the main list with its responses intact.",
  schema: z.object({
    id: z
      .union([z.string(), z.array(z.string()).min(1)])
      .describe("Form ID or IDs to restore (required)"),
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

    const results: Array<{ id: string; success: true }> = [];
    await db.transaction(async (tx) => {
      for (const existing of existingForms) {
        const id = existing.id;
        const now = new Date().toISOString();
        await tx
          .update(schema.forms)
          .set({ deletedAt: null, updatedAt: now })
          .where(eq(schema.forms.id, id));
        results.push({ id, success: true });
      }
    });
    for (const existing of existingForms) {
      invalidatePublicFormCache(existing);
    }
    return Array.isArray(args.id) ? { results } : results[0];
  },
});

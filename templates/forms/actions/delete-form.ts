import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
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
    const ids = Array.isArray(args.id) ? args.id : [args.id];
    const deleteOne = async (id: string) => {
      await assertAccess("form", id, "admin");

      const db = getDb();
      const [existing] = await db
        .select()
        .from(schema.forms)
        .where(eq(schema.forms.id, id))
        .limit(1);

      if (!existing) {
        fail(`Form ${id} not found`, {
          errorCode: "form_not_found",
          statusCode: 404,
        });
      }

      if (args.purge) {
        await db
          .delete(schema.responses)
          .where(eq(schema.responses.formId, id));
        await db.delete(schema.forms).where(eq(schema.forms.id, id));
        invalidatePublicFormCache(existing);
        return { id, success: true, purged: true };
      }

      const now = new Date().toISOString();
      await db
        .update(schema.forms)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(schema.forms.id, id));

      invalidatePublicFormCache(existing);
      return { id, success: true, purged: false, deletedAt: now };
    };

    if (ids.length === 1) return deleteOne(ids[0]!);
    const results = [];
    for (const id of ids) {
      try {
        results.push(await deleteOne(id));
      } catch (error) {
        // A forbidden target is a security-relevant failure, not an ordinary
        // per-item outcome like "not found" — reject the whole batch instead
        // of reporting it as a completed action with a false-looking result.
        if (error instanceof ForbiddenError) throw error;
        results.push({
          id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      success: results.every((result) => result.success),
      purged: args.purge,
      results,
    };
  },
});

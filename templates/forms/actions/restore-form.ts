import { defineAction, fail } from "@agent-native/core/action";
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
    const ids = Array.isArray(args.id) ? args.id : [args.id];
    const restoreOne = async (id: string) => {
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

      const now = new Date().toISOString();
      await db
        .update(schema.forms)
        .set({ deletedAt: null, updatedAt: now })
        .where(eq(schema.forms.id, id));

      invalidatePublicFormCache(existing);
      return { id, success: true, restoredAt: now };
    };

    if (ids.length === 1) return restoreOne(ids[0]!);
    const results = [];
    for (const id of ids) {
      try {
        results.push(await restoreOne(id));
      } catch (error) {
        results.push({
          id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      success: results.every((result) => result.success),
      results,
    };
  },
});

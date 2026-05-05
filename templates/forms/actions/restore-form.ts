import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Restore a soft-deleted form. The form returns to the main list with its responses intact.",
  schema: z.object({
    id: z.string().describe("Form ID to restore (required)"),
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

    const now = new Date().toISOString();
    await db
      .update(schema.forms)
      .set({ deletedAt: null, updatedAt: now })
      .where(eq(schema.forms.id, args.id));

    return { success: true };
  },
});

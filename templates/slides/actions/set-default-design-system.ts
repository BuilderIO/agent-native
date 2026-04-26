import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess, accessFilter } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Set a design system as the default. Unsets any previously-default design system for this user.",
  schema: z.object({
    id: z.string().describe("Design system ID to set as default"),
  }),
  run: async ({ id }) => {
    await assertAccess("design-system", id, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    // Unset all existing defaults for the current user's accessible design systems
    const accessible = await db
      .select({ id: schema.designSystems.id })
      .from(schema.designSystems)
      .where(accessFilter(schema.designSystems, schema.designSystemShares));

    for (const row of accessible) {
      await db
        .update(schema.designSystems)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(schema.designSystems.id, row.id));
    }

    // Set the chosen one as default
    await db
      .update(schema.designSystems)
      .set({ isDefault: true, updatedAt: now })
      .where(eq(schema.designSystems.id, id));

    return { id, isDefault: true };
  },
});

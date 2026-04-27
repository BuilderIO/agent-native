import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

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

    const userEmail = getRequestUserEmail();

    // Use a transaction to atomically unset all defaults then set the new one.
    // Without a transaction, concurrent set-default requests can interleave and
    // leave multiple design systems marked as default.
    await db.transaction(async (tx) => {
      await tx
        .update(schema.designSystems)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(schema.designSystems.ownerEmail, userEmail ?? ""));

      await tx
        .update(schema.designSystems)
        .set({ isDefault: true, updatedAt: now })
        .where(eq(schema.designSystems.id, id));
    });

    return { id, isDefault: true };
  },
});

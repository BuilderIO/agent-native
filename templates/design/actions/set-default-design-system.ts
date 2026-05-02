import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
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
    if (!userEmail) throw new Error("no authenticated user");

    const [target] = await db
      .select({ ownerEmail: schema.designSystems.ownerEmail })
      .from(schema.designSystems)
      .where(eq(schema.designSystems.id, id))
      .limit(1);

    if (target?.ownerEmail !== userEmail) {
      throw new Error("Only the owner can set a design system as default");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.designSystems)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(schema.designSystems.ownerEmail, userEmail));

      await tx
        .update(schema.designSystems)
        .set({ isDefault: true, updatedAt: now })
        .where(
          and(
            eq(schema.designSystems.id, id),
            eq(schema.designSystems.ownerEmail, userEmail),
          ),
        );
    });

    return { id, isDefault: true };
  },
});

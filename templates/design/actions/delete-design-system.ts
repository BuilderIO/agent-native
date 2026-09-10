import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { DESIGN_SYSTEM_MANAGE_ROLE } from "../server/lib/design-system-access.js";

export default defineAction({
  description:
    "Delete a design system. Requires admin access or higher. Designs linked " +
    "to it are unlinked.",
  schema: z.object({
    id: z.string().min(1).describe("Design system ID to delete"),
  }),
  run: async ({ id }) => {
    await assertAccess("design-system", id, DESIGN_SYSTEM_MANAGE_ROLE);

    const db = getDb();

    await db.transaction(async (tx) => {
      await tx
        .update(schema.designs)
        .set({ designSystemId: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.designs.designSystemId, id));

      await tx
        .delete(schema.designSystemShares)
        .where(eq(schema.designSystemShares.resourceId, id));

      await tx
        .delete(schema.designSystems)
        .where(eq(schema.designSystems.id, id));
    });

    return { id, deleted: true };
  },
});

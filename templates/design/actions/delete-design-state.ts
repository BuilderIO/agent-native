import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Delete a design state, fixture, or capture row. " +
    "This is irreversible; the design itself is unaffected.",
  schema: z.object({
    id: z.string().describe("design_state row id to delete"),
    designId: z
      .string()
      .describe(
        "Design project ID (required for access check; must match the state's design_id).",
      ),
  }),
  run: async ({ id, designId }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();

    // Verify the row belongs to this design before deleting.
    const [existing] = await db
      .select({ id: schema.designState.id, name: schema.designState.name })
      .from(schema.designState)
      .where(
        and(
          eq(schema.designState.id, id),
          eq(schema.designState.designId, designId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error(
        `design_state row '${id}' not found for design '${designId}'.`,
      );
    }

    await db
      .delete(schema.designState)
      .where(
        and(
          eq(schema.designState.id, id),
          eq(schema.designState.designId, designId),
        ),
      );

    return { deleted: true, id, designId, name: existing.name };
  },
});

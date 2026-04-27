import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Link a design system to a composition. The composition will use this design system's " +
    "colors, typography, and styling. Requires editor access on the composition.",
  schema: z.object({
    compositionId: z
      .string()
      .describe("Composition ID to apply the design system to"),
    designSystemId: z
      .string()
      .describe("Design system ID to link to the composition"),
  }),
  run: async ({ compositionId, designSystemId }) => {
    // Verify access to both the composition and the design system
    await assertAccess("composition", compositionId, "editor");
    await assertAccess("design-system", designSystemId, "viewer");

    const db = getDb();
    const now = new Date().toISOString();

    await db
      .update(schema.compositions)
      .set({ designSystemId, updatedAt: now })
      .where(eq(schema.compositions.id, compositionId));

    return { compositionId, designSystemId, applied: true };
  },
});

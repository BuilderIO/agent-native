import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Delete a design project and all associated files and versions. Requires admin access.",
  schema: z.object({
    id: z.string().describe("Design ID to delete"),
  }),
  run: async ({ id }) => {
    await assertAccess("design", id, "admin");

    const db = getDb();

    // Delete associated files first
    await db
      .delete(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));

    // Delete associated versions
    await db
      .delete(schema.designVersions)
      .where(eq(schema.designVersions.designId, id));

    // Delete the design itself
    await db.delete(schema.designs).where(eq(schema.designs.id, id));

    return { id, deleted: true };
  },
});

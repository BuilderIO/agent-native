import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Delete a file from a design project. Validates ownership via the parent design's access.",
  schema: z.object({
    id: z.string().describe("File ID to delete"),
  }),
  run: async ({ id }) => {
    const db = getDb();

    // Look up the file to get its designId for access check
    const [file] = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(
        and(
          eq(schema.designFiles.id, id),
          accessFilter(schema.designs, schema.designShares),
        ),
      )
      .limit(1);

    if (!file) {
      throw new Error(`File not found: ${id}`);
    }

    await assertAccess("design", file.designId, "editor");

    const now = new Date().toISOString();

    await db.delete(schema.designFiles).where(eq(schema.designFiles.id, id));

    // Update the parent design's updatedAt timestamp
    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, file.designId));

    return { id, deleted: true };
  },
});

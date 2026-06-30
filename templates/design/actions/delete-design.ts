import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete a design project and all associated files and versions. Requires admin access.",
  schema: z.object({
    id: z.string().describe("Design ID to delete"),
  }),
  run: async ({ id }) => {
    await assertAccess("design", id, "admin");

    const db = getDb();

    await db
      .delete(schema.designShares)
      .where(eq(schema.designShares.resourceId, id));

    await db
      .delete(schema.componentIndex)
      .where(eq(schema.componentIndex.designId, id));

    await db
      .delete(schema.motionTimeline)
      .where(eq(schema.motionTimeline.designId, id));

    await db
      .delete(schema.designState)
      .where(eq(schema.designState.designId, id));

    await db
      .delete(schema.designReviewSnapshot)
      .where(eq(schema.designReviewSnapshot.designId, id));

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

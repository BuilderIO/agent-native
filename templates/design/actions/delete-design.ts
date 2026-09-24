import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";

export default defineAction({
  description:
    "Delete a design project and all associated files and versions. Requires admin access.",
  schema: z.object({
    id: z.string().describe("Design ID to delete"),
  }),
  run: async ({ id }) => {
    await assertAccess("design", id, "admin");

    await withDesignSourceMutationTransaction(id, async (tx) => {
      await tx
        .delete(schema.designShares)
        .where(eq(schema.designShares.resourceId, id));

      await tx
        .delete(schema.designAccessRequests)
        .where(eq(schema.designAccessRequests.designId, id));

      await tx
        .delete(schema.componentIndex)
        .where(eq(schema.componentIndex.designId, id));

      await tx
        .delete(schema.motionTimeline)
        .where(eq(schema.motionTimeline.designId, id));

      await tx
        .delete(schema.designState)
        .where(eq(schema.designState.designId, id));

      await tx
        .delete(schema.designReviewSnapshot)
        .where(eq(schema.designReviewSnapshot.designId, id));

      // Delete associated files first
      await tx
        .delete(schema.designFiles)
        .where(eq(schema.designFiles.designId, id));

      // Delete associated versions
      await tx
        .delete(schema.designVersions)
        .where(eq(schema.designVersions.designId, id));

      // Delete the design itself
      await tx.delete(schema.designs).where(eq(schema.designs.id, id));
    });

    return { id, deleted: true };
  },
});

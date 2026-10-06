import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import {
  deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction,
} from "../server/lib/visual-edit-snapshot-blobs.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";

export default defineAction({
  description:
    "Delete a design project and all associated files and versions. Requires admin access.",
  schema: z.object({
    id: z.string().describe("Design ID to delete"),
  }),
  run: async ({ id }) => {
    await assertAccess("design", id, "admin");

    const snapshotBlobHandles = await withDesignSourceMutationTransaction(
      id,
      async (tx) => {
        const snapshots = await tx
          .select({
            blobHandle: schema.designVisualEditSnapshots.blobHandle,
          })
          .from(schema.designVisualEditSnapshots)
          .where(eq(schema.designVisualEditSnapshots.designId, id))
          .for("update");

        await queueVisualEditSnapshotBlobCleanupInTransaction(
          tx,
          snapshots.map((snapshot) => snapshot.blobHandle),
        );

        await tx
          .delete(schema.designVisualEditPending)
          .where(eq(schema.designVisualEditPending.designId, id));

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

        await tx
          .delete(schema.designFiles)
          .where(eq(schema.designFiles.designId, id));

        await tx
          .delete(schema.designVersions)
          .where(eq(schema.designVersions.designId, id));

        await tx.delete(schema.designs).where(eq(schema.designs.id, id));
        return snapshots.map((snapshot) => snapshot.blobHandle);
      },
    );
    await deleteVisualEditSnapshotBlobs(snapshotBlobHandles);

    return { id, deleted: true };
  },
});

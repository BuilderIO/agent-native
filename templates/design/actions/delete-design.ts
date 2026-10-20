import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import {
  deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction,
} from "../server/lib/visual-edit-snapshot-blobs.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";

const expectedCreatedShellSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  data: z.string(),
  dataOperationRevisions: z.string(),
  liveCollaborationEnabled: z.boolean(),
  projectType: z.string(),
  designSystemId: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  ownerEmail: z.string(),
  orgId: z.string().nullable(),
  visibility: z.string(),
});

export default defineAction({
  description:
    "Delete a design project and all associated files and versions. Requires admin access. Optionally, delete only if it is still the unchanged private shell returned by a recent create-design call.",
  schema: z.object({
    id: z.string().describe("Design ID to delete"),
    expectedCreatedShell: expectedCreatedShellSchema
      .optional()
      .describe(
        "When supplied, delete only if this personal private design shell is unchanged and has no user content, versions, shares, or state. Used to safely clean up a newly created shell after a failed handoff.",
      ),
  }),
  run: async ({ id, expectedCreatedShell }) => {
    await assertAccess("design", id, "admin");

    const callerEmail = getRequestUserEmail();
    const deletion = await withDesignSourceMutationTransaction(
      id,
      async (tx) => {
        if (expectedCreatedShell) {
          await tx.execute(sql`LOCK TABLE design_shares IN SHARE MODE`);

          const [design] = await tx
            .select({
              id: schema.designs.id,
              title: schema.designs.title,
              description: schema.designs.description,
              data: schema.designs.data,
              dataOperationRevisions: schema.designs.dataOperationRevisions,
              liveCollaborationEnabled: schema.designs.liveCollaborationEnabled,
              projectType: schema.designs.projectType,
              designSystemId: schema.designs.designSystemId,
              createdAt: schema.designs.createdAt,
              updatedAt: schema.designs.updatedAt,
              ownerEmail: schema.designs.ownerEmail,
              orgId: schema.designs.orgId,
              visibility: schema.designs.visibility,
            })
            .from(schema.designs)
            .where(eq(schema.designs.id, id))
            .for("update");

          const normalizeEmail = (email: string) => email.trim().toLowerCase();
          if (
            !design ||
            !callerEmail ||
            design.id !== id ||
            design.title !== expectedCreatedShell.title ||
            design.description !== expectedCreatedShell.description ||
            design.data !== expectedCreatedShell.data ||
            design.dataOperationRevisions !==
              expectedCreatedShell.dataOperationRevisions ||
            design.liveCollaborationEnabled !==
              expectedCreatedShell.liveCollaborationEnabled ||
            design.projectType !== expectedCreatedShell.projectType ||
            design.designSystemId !== expectedCreatedShell.designSystemId ||
            design.createdAt !== expectedCreatedShell.createdAt ||
            design.updatedAt !== expectedCreatedShell.updatedAt ||
            design.ownerEmail !== expectedCreatedShell.ownerEmail ||
            design.orgId !== expectedCreatedShell.orgId ||
            design.visibility !== expectedCreatedShell.visibility ||
            normalizeEmail(design.ownerEmail) !== normalizeEmail(callerEmail) ||
            expectedCreatedShell.orgId !== null ||
            expectedCreatedShell.visibility !== "private" ||
            expectedCreatedShell.createdAt === null ||
            expectedCreatedShell.updatedAt !== expectedCreatedShell.createdAt
          ) {
            return { deleted: false, privateBlobHandles: [] };
          }

          const [share] = await tx
            .select({ id: schema.designShares.id })
            .from(schema.designShares)
            .where(eq(schema.designShares.resourceId, id))
            .limit(1);
          if (share) return { deleted: false, privateBlobHandles: [] };

          const relatedRows = [
            await tx
              .select({ id: schema.designAccessRequests.id })
              .from(schema.designAccessRequests)
              .where(eq(schema.designAccessRequests.designId, id))
              .limit(1),
            await tx
              .select({ id: schema.designFiles.id })
              .from(schema.designFiles)
              .where(eq(schema.designFiles.designId, id))
              .limit(1),
            await tx
              .select({ id: schema.designVersions.id })
              .from(schema.designVersions)
              .where(eq(schema.designVersions.designId, id))
              .limit(1),
            await tx
              .select({ id: schema.designState.id })
              .from(schema.designState)
              .where(eq(schema.designState.designId, id))
              .limit(1),
            await tx
              .select({ id: schema.componentIndex.id })
              .from(schema.componentIndex)
              .where(eq(schema.componentIndex.designId, id))
              .limit(1),
            await tx
              .select({ id: schema.motionTimeline.id })
              .from(schema.motionTimeline)
              .where(eq(schema.motionTimeline.designId, id))
              .limit(1),
            await tx
              .select({ id: schema.designLocalhostWriteGrants.id })
              .from(schema.designLocalhostWriteGrants)
              .where(eq(schema.designLocalhostWriteGrants.designId, id))
              .limit(1),
            await tx
              .select({ id: schema.designFusionEdits.id })
              .from(schema.designFusionEdits)
              .where(eq(schema.designFusionEdits.designId, id))
              .limit(1),
            await tx
              .select({ id: schema.designReviewSnapshot.id })
              .from(schema.designReviewSnapshot)
              .where(eq(schema.designReviewSnapshot.designId, id))
              .limit(1),
            await tx
              .select({ designId: schema.designVisualEditPending.designId })
              .from(schema.designVisualEditPending)
              .where(eq(schema.designVisualEditPending.designId, id))
              .limit(1),
            await tx
              .select({ fileId: schema.designVisualEditSnapshots.fileId })
              .from(schema.designVisualEditSnapshots)
              .where(eq(schema.designVisualEditSnapshots.designId, id))
              .limit(1),
            await tx
              .select({ id: schema.designScreenRestoreClaims.id })
              .from(schema.designScreenRestoreClaims)
              .where(eq(schema.designScreenRestoreClaims.designId, id))
              .limit(1),
            await tx
              .select({ id: schema.designBoardReplayScreenshots.id })
              .from(schema.designBoardReplayScreenshots)
              .where(eq(schema.designBoardReplayScreenshots.designId, id))
              .limit(1),
          ];
          if (relatedRows.some((rows) => rows.length > 0)) {
            return { deleted: false, privateBlobHandles: [] };
          }
        }

        const snapshots = await tx
          .select({
            blobHandle: schema.designVisualEditSnapshots.blobHandle,
          })
          .from(schema.designVisualEditSnapshots)
          .where(eq(schema.designVisualEditSnapshots.designId, id))
          .for("update");
        const screenshots = await tx
          .select({
            blobHandle: schema.designBoardReplayScreenshots.blobHandle,
          })
          .from(schema.designBoardReplayScreenshots)
          .where(eq(schema.designBoardReplayScreenshots.designId, id))
          .for("update");

        await queueVisualEditSnapshotBlobCleanupInTransaction(tx, [
          ...snapshots.map((snapshot) => snapshot.blobHandle),
          ...screenshots.map((screenshot) => screenshot.blobHandle),
        ]);

        await tx
          .delete(schema.designBoardReplayScreenshots)
          .where(eq(schema.designBoardReplayScreenshots.designId, id));

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
        return {
          deleted: true,
          privateBlobHandles: [
            ...snapshots.map((snapshot) => snapshot.blobHandle),
            ...screenshots.map((screenshot) => screenshot.blobHandle),
          ],
        };
      },
    );
    if (!deletion.deleted) return { id, deleted: false };
    await deleteVisualEditSnapshotBlobs(deletion.privateBlobHandles);

    return { id, deleted: true };
  },
});

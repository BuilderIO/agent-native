import { defineAction, fail } from "@agent-native/core/action";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import { assertVisualEditAccountEditor } from "../server/lib/visual-edit-collaboration.js";
import {
  deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction,
} from "../server/lib/visual-edit-snapshot-blobs.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";

export default defineAction({
  description:
    "Enable or disable shared live HTML previews for a Design. Requires a signed-in account with editor access; disabled by default.",
  requiresAuth: true,
  schema: z
    .object({
      designId: z.string().min(1).describe("Design project ID."),
      enabled: z
        .boolean()
        .describe("Whether people without the owner's localhost may view it."),
    })
    .strict(),
  run: async ({ designId, enabled }) => {
    await assertVisualEditAccountEditor(designId);

    const cleanupHandles = await withDesignSourceMutationTransaction(
      designId,
      async (tx) => {
        const [design] = await tx
          .select({ id: schema.designs.id })
          .from(schema.designs)
          .where(eq(schema.designs.id, designId))
          .for("update")
          .limit(1);
        if (!design) {
          fail("Design not found.", {
            statusCode: 404,
            errorCode: "not_found",
          });
        }

        await tx
          .update(schema.designs)
          .set({
            liveCollaborationEnabled: enabled,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.designs.id, designId));

        if (enabled) return [];
        const table = schema.designVisualEditSnapshots;
        const rows = await tx
          .select({ blobHandle: table.blobHandle })
          .from(table)
          .where(eq(table.designId, designId))
          .for("update");
        const handles = rows.map((row) => row.blobHandle);
        await tx
          .update(table)
          .set({
            html: "",
            blobHandle: null,
            captureRevision: sql`${table.captureRevision} + 1`,
            publishedRevision: 0n,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(table.designId, designId));
        await queueVisualEditSnapshotBlobCleanupInTransaction(tx, handles);
        return handles;
      },
    );

    if (!enabled) {
      await deleteVisualEditSnapshotBlobs(cleanupHandles);
    }

    return { designId, enabled };
  },
});

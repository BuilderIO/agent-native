import { defineAction, fail } from "@agent-native/core/action";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import { publishesDesignChange } from "../server/lib/design-change-events.js";
import { assertVisualEditAccountEditor } from "../server/lib/visual-edit-collaboration.js";
import {
  deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction,
} from "../server/lib/visual-edit-snapshot-blobs.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";

const designAction = defineAction({
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
          .where(
            and(
              eq(schema.designs.id, designId),
              accessFilter(
                schema.designs,
                schema.designShares,
                { ...currentAccess(), authCapability: undefined },
                "editor",
              ),
            ),
          )
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
          .where(
            and(
              eq(schema.designs.id, designId),
              accessFilter(
                schema.designs,
                schema.designShares,
                { ...currentAccess(), authCapability: undefined },
                "editor",
              ),
            ),
          );

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

export default publishesDesignChange(designAction, {
  designId: (p) => p.designId,
});

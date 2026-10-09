import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { queueVisualEditSnapshotBlobCleanupInTransaction } from "../server/lib/visual-edit-snapshot-blobs.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import { JOURNEY_STAGED_REPLAY_ROW_PREFIX } from "../shared/journey-canvas.js";

const inputSchema = z
  .object({
    designId: z.string().min(1).max(128),
    importId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  })
  .strict();

const likePrefix = (prefix: string) => `${prefix.replace(/[\\%_]/g, "\\$&")}%`;

export default defineAction({
  description:
    "Discard one abandoned staged journey-frame import from a Design and queue its private screenshot blobs for cleanup. Pass the exact designId and importId returned by stage-journey-canvas-frames; frames already promoted into the storyboard are left intact.",
  requiresAuth: true,
  schema: inputSchema,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input) => {
    if (!getRequestUserEmail()) {
      fail("A signed-in user is required.", { statusCode: 401 });
    }
    await assertAccess("design", input.designId, "editor");
    const rows = await withDesignSourceMutationTransaction(
      input.designId,
      async (tx) => {
        const staged = await tx
          .select({
            id: schema.designBoardReplayScreenshots.id,
            blobHandle: schema.designBoardReplayScreenshots.blobHandle,
          })
          .from(schema.designBoardReplayScreenshots)
          .where(
            and(
              eq(schema.designBoardReplayScreenshots.designId, input.designId),
              eq(
                schema.designBoardReplayScreenshots.boardFileId,
                `journey-canvas-stage:${input.importId}`,
              ),
              like(
                schema.designBoardReplayScreenshots.id,
                likePrefix(JOURNEY_STAGED_REPLAY_ROW_PREFIX),
              ),
            ),
          )
          .for("update");
        if (staged.length === 0) return [];

        await tx.delete(schema.designBoardReplayScreenshots).where(
          and(
            eq(schema.designBoardReplayScreenshots.designId, input.designId),
            inArray(
              schema.designBoardReplayScreenshots.id,
              staged.map((row) => row.id),
            ),
          ),
        );
        await queueVisualEditSnapshotBlobCleanupInTransaction(
          tx,
          staged.map((row) => row.blobHandle),
        );
        return staged;
      },
    );
    return {
      designId: input.designId,
      importId: input.importId,
      removedFrames: rows.length,
    };
  },
});

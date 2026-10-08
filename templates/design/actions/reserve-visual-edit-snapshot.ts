import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import {
  assertVisualEditAccountEditor,
  requireVisualEditCollaboration,
} from "../server/lib/visual-edit-collaboration.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import { assertLocalhostScreenMetadata } from "./publish-visual-edit-snapshot.js";

export default defineAction({
  description:
    "Reserve the next server-ordered HTML capture for one Localhost screen before capturing it. Requires a signed-in editor and enabled live collaboration.",
  requiresAuth: true,
  agentTool: false,
  mcpTool: false,
  schema: z
    .object({
      designId: z.string().min(1).describe("Design project ID."),
      fileId: z.string().min(1).describe("Localhost screen file ID."),
    })
    .strict(),
  run: async ({ designId, fileId }) => {
    await assertVisualEditAccountEditor(designId);

    return withDesignSourceMutationTransaction(designId, async (tx) => {
      const [design] = await tx
        .select({
          data: schema.designs.data,
          liveCollaborationEnabled: schema.designs.liveCollaborationEnabled,
          visibility: schema.designs.visibility,
          ownerEmail: schema.designs.ownerEmail,
          orgId: schema.designs.orgId,
        })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId))
        .limit(1);
      if (!design) {
        fail("Design not found.", {
          errorCode: "design_not_found",
        });
      }
      requireVisualEditCollaboration(design.liveCollaborationEnabled);

      const [file] = await tx
        .select({
          id: schema.designFiles.id,
          content: schema.designFiles.content,
          fileType: schema.designFiles.fileType,
        })
        .from(schema.designFiles)
        .where(
          and(
            eq(schema.designFiles.id, fileId),
            eq(schema.designFiles.designId, designId),
          ),
        )
        .limit(1);
      if (!file) {
        fail("The screen does not belong to this design.", {
          errorCode: "visual_edit_snapshot_file_mismatch",
        });
      }
      if (file.fileType.toLowerCase() !== "html") {
        fail("Visual-edit snapshots can only be published for HTML screens.", {
          errorCode: "visual_edit_snapshot_not_html",
        });
      }

      assertLocalhostScreenMetadata(design.data, fileId, file.content);
      const table = schema.designVisualEditSnapshots;
      const [reservation] = await tx
        .insert(table)
        .values({
          designId,
          fileId,
          html: "",
          captureRevision: 1n,
          publishedRevision: 0n,
          visibility: design.visibility,
          ownerEmail: design.ownerEmail,
          orgId: design.orgId,
        })
        .onConflictDoUpdate({
          target: [table.designId, table.fileId],
          set: {
            captureRevision: sql`${table.captureRevision} + 1`,
            visibility: design.visibility,
            ownerEmail: design.ownerEmail,
            orgId: design.orgId,
          },
        })
        .returning({ captureRevision: table.captureRevision });

      if (!reservation) {
        throw new Error(
          "The visual-edit snapshot reservation was not created.",
        );
      }

      return {
        designId,
        fileId,
        reservationToken: reservation.captureRevision.toString(),
      };
    });
  },
});

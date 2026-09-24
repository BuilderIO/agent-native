import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertLocalhostScreenMetadata } from "./publish-visual-edit-snapshot.js";

export default defineAction({
  description:
    "Reserve the next server-ordered HTML capture for one Localhost screen before capturing it. Requires editor access to the Design.",
  requiresAuth: true,
  agentTool: false,
  mcpTool: false,
  capabilityScopes: ["visual-edit"],
  schema: z
    .object({
      designId: z.string().min(1).describe("Design project ID."),
      fileId: z.string().min(1).describe("Localhost screen file ID."),
    })
    .strict(),
  run: async ({ designId, fileId }) => {
    const access = await assertAccess("design", designId, "editor");
    const design = access.resource as typeof schema.designs.$inferSelect;
    const [file] = await getDb()
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
    const [reservation] = await getDb()
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
      throw new Error("The visual-edit snapshot reservation was not created.");
    }

    return {
      designId,
      fileId,
      reservationToken: reservation.captureRevision.toString(),
    };
  },
});

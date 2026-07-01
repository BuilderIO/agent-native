import { defineAction } from "@agent-native/core";
import {
  hasCollabState,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Update an existing file in a design project. " +
    "Only provided fields are updated; omitted fields are left unchanged. " +
    "Also updates the parent design's updatedAt timestamp.",
  schema: z.object({
    id: z.string().describe("File ID to update"),
    content: z.string().optional().describe("Updated file content"),
    filename: z.string().optional().describe("New filename"),
    fileType: z
      .enum(["html", "css", "jsx", "asset"])
      .optional()
      .describe("Updated file type"),
    syncCollab: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Whether to mirror content updates into the live collaboration document.",
      ),
  }),
  run: async ({ id, content, filename, fileType, syncCollab }) => {
    // Path traversal guard on filename
    if (
      filename &&
      (filename.includes("..") ||
        filename.includes("/") ||
        filename.includes("\\"))
    ) {
      throw new Error("Invalid filename: path traversal not allowed");
    }

    const db = getDb();
    const now = new Date().toISOString();

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

    // Reject a rename that would collide with an existing filename in the same
    // design. The collision check and the write run in one transaction so they
    // can't be interleaved by a concurrent rename. (A DB-level UNIQUE index on
    // (designId, filename) would be the strongest guarantee but is a non-additive
    // schema change on existing data, so it's deferred.)
    await db.transaction(async (tx) => {
      if (filename !== undefined) {
        const [collision] = await tx
          .select({ id: schema.designFiles.id })
          .from(schema.designFiles)
          .where(
            and(
              eq(schema.designFiles.designId, file.designId),
              eq(schema.designFiles.filename, filename),
            ),
          )
          .limit(1);
        if (collision && collision.id !== id) {
          throw new Error(
            `File "${filename}" already exists in design ${file.designId}`,
          );
        }
      }

      const updates: Record<string, unknown> = { updatedAt: now };
      if (content !== undefined) updates.content = content;
      if (filename !== undefined) updates.filename = filename;
      if (fileType !== undefined) updates.fileType = fileType;

      await tx
        .update(schema.designFiles)
        .set(updates)
        .where(eq(schema.designFiles.id, id));
    });

    // Push content through the collab layer so live editors see the change
    if (content !== undefined && syncCollab) {
      const collabExists = await hasCollabState(id);
      if (collabExists) {
        await applyText(id, content, "content", "agent");
      } else {
        await seedFromText(id, content);
      }
    }

    // Update the parent design's updatedAt timestamp
    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, file.designId));

    return { id, updated: true };
  },
});

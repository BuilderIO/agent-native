import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

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
  }),
  run: async ({ id, content, filename, fileType }) => {
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
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.id, id))
      .limit(1);

    if (!file) {
      throw new Error(`File not found: ${id}`);
    }

    await assertAccess("design", file.designId, "editor");

    const updates: Record<string, unknown> = { updatedAt: now };
    if (content !== undefined) updates.content = content;
    if (filename !== undefined) updates.filename = filename;
    if (fileType !== undefined) updates.fileType = fileType;

    await db
      .update(schema.designFiles)
      .set(updates)
      .where(eq(schema.designFiles.id, id));

    // Update the parent design's updatedAt timestamp
    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, file.designId));

    return { id, updated: true };
  },
});

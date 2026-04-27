import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Add a new file to a design project. Validates that the design exists and " +
    "the user has editor access. Returns the new file's ID and filename.",
  schema: z.object({
    designId: z.string().describe("Design project ID to add the file to"),
    filename: z.string().describe("Filename (e.g. 'index.html', 'styles.css')"),
    content: z.string().describe("File content"),
    fileType: z
      .enum(["html", "css", "jsx", "asset"])
      .optional()
      .default("html")
      .describe("Type of file"),
  }),
  run: async ({ designId, filename, content, fileType }) => {
    // Path traversal guard
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      throw new Error("Invalid filename: path traversal not allowed");
    }

    await assertAccess("design", designId, "editor");

    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();

    await db.insert(schema.designFiles).values({
      id,
      designId,
      filename,
      fileType: fileType ?? "html",
      content,
      createdAt: now,
      updatedAt: now,
    });

    // Update the design's updatedAt timestamp
    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, designId));

    return { id, filename, fileType };
  },
});

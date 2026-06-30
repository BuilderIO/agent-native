import { defineAction } from "@agent-native/core";
import { seedFromText } from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Add a new file to a design project. Validates that the design exists and " +
    "the user has editor access. Returns the new file's ID, filename, and design URL path when the file is renderable.",
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

    // Guard against duplicate (designId, filename) — edit-design uses .limit(1)
    // which is non-deterministic when multiple rows match the same key.
    const [existing] = await db
      .select({ id: schema.designFiles.id })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.designId, designId),
          eq(schema.designFiles.filename, filename),
        ),
      )
      .limit(1);
    if (existing) {
      throw new Error(
        `File "${filename}" already exists in design ${designId} — use edit-design to modify it`,
      );
    }

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

    // Seed collab state for the new file
    await seedFromText(id, content);

    // Update the design's updatedAt timestamp
    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, designId));

    const resolvedFileType = fileType ?? "html";
    const renderable =
      (resolvedFileType === "html" || resolvedFileType === "jsx") &&
      content.trim().length > 0;

    return {
      id,
      designId,
      filename,
      fileType: resolvedFileType,
      renderable,
      urlPath: renderable ? `/design/${designId}` : null,
    };
  },
});

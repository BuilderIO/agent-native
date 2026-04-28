import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import {
  hasCollabState,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";

export default defineAction({
  description:
    "Save generated design content to a design project. " +
    "The agent calls this after generating HTML/CSS/JSX content to persist it " +
    "as files in the design project. Creates or updates files as needed. " +
    "Returns the saved files for iframe rendering.",
  schema: z.object({
    designId: z.string().describe("Design project ID to save content to"),
    prompt: z.string().describe("The generation prompt (stored for reference)"),
    files: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.array(
          z.object({
            filename: z.string().describe("Filename (e.g. 'index.html')"),
            content: z.string().describe("File content"),
            fileType: z
              .enum(["html", "css", "jsx", "asset"])
              .optional()
              .default("html")
              .describe("Type of file"),
          }),
        ),
      )
      .describe("Array of files to create/update in the design project"),
    designSystemId: z
      .string()
      .optional()
      .describe("Design system ID used for generation"),
    projectType: z
      .enum(["prototype", "other"])
      .optional()
      .describe("Project type hint for generation"),
  }),
  run: async ({ designId, prompt, files, designSystemId, projectType }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    // Path traversal guard on all filenames
    for (const file of files) {
      if (
        file.filename.includes("..") ||
        file.filename.includes("/") ||
        file.filename.includes("\\")
      ) {
        throw new Error(
          `Invalid filename "${file.filename}": path traversal not allowed`,
        );
      }
    }

    const savedFiles: Array<{
      id: string;
      filename: string;
      fileType: string;
    }> = [];

    // Get existing files for this design
    const existingFiles = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));

    const existingByName = new Map(existingFiles.map((f) => [f.filename, f]));

    for (const file of files) {
      const existing = existingByName.get(file.filename);
      if (existing) {
        // Update existing file
        await db
          .update(schema.designFiles)
          .set({
            content: file.content,
            fileType: file.fileType ?? "html",
            updatedAt: now,
          })
          .where(eq(schema.designFiles.id, existing.id));

        // Push content through collab layer for live editors
        const collabExists = await hasCollabState(existing.id);
        if (collabExists) {
          await applyText(existing.id, file.content, "content", "agent");
        } else {
          await seedFromText(existing.id, file.content);
        }

        savedFiles.push({
          id: existing.id,
          filename: file.filename,
          fileType: file.fileType ?? "html",
        });
      } else {
        // Create new file
        const fileId = nanoid();
        await db.insert(schema.designFiles).values({
          id: fileId,
          designId,
          filename: file.filename,
          fileType: file.fileType ?? "html",
          content: file.content,
          createdAt: now,
          updatedAt: now,
        });

        // Seed collab state for the new file
        await seedFromText(fileId, file.content);

        savedFiles.push({
          id: fileId,
          filename: file.filename,
          fileType: file.fileType ?? "html",
        });
      }
    }

    // Update design metadata
    const designUpdates: Record<string, unknown> = { updatedAt: now };
    if (designSystemId !== undefined) {
      designUpdates.designSystemId = designSystemId;
    }
    if (projectType !== undefined) {
      designUpdates.projectType = projectType;
    }

    // Store generation metadata in the data field
    const generationMeta = JSON.stringify({
      lastPrompt: prompt,
      generatedAt: now,
      fileCount: files.length,
    });
    designUpdates.data = generationMeta;

    await db
      .update(schema.designs)
      .set(designUpdates)
      .where(eq(schema.designs.id, designId));

    return {
      designId,
      savedFiles,
      fileCount: savedFiles.length,
    };
  },
});

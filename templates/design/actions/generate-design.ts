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
    tweaks: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z
          .array(
            z.object({
              id: z.string(),
              label: z.string(),
              type: z.enum(["color-swatch", "segment", "slider", "toggle"]),
              options: z
                .array(
                  z.object({
                    label: z.string(),
                    value: z.string(),
                    color: z.string().optional(),
                  }),
                )
                .optional(),
              min: z.number().optional(),
              max: z.number().optional(),
              step: z.number().optional(),
              defaultValue: z.union([z.string(), z.number(), z.boolean()]),
              cssVar: z.string().optional(),
            }),
          )
          .optional(),
      )
      .optional()
      .describe(
        "Optional array of tweak definitions (color swatches, segments, " +
          "sliders, toggles) bound to CSS custom properties in the design. " +
          "Surface 3-6 of the most impactful knobs (accent color, density, " +
          "radius, dark mode, font choice). Each must reference a CSS var " +
          "the design's `:root` block actually uses.",
      ),
  }),
  run: async ({
    designId,
    prompt,
    files,
    designSystemId,
    projectType,
    tweaks,
  }) => {
    await assertAccess("design", designId, "editor");
    if (designSystemId) {
      await assertAccess("design-system", designSystemId, "viewer");
    }

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

    // Merge with existing data so tweak definitions survive content updates.
    // The data column is a free-form JSON blob; we own these keys here and
    // leave anything else intact.
    const [existingDesign] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId));
    let prevData: Record<string, unknown> = {};
    if (existingDesign?.data) {
      try {
        const parsed = JSON.parse(existingDesign.data);
        if (parsed && typeof parsed === "object") prevData = parsed;
      } catch {
        // Stale or invalid JSON — start fresh.
      }
    }
    const mergedData: Record<string, unknown> = {
      ...prevData,
      lastPrompt: prompt,
      generatedAt: now,
      fileCount: files.length,
    };
    if (tweaks !== undefined) {
      mergedData.tweaks = tweaks;
    }
    designUpdates.data = JSON.stringify(mergedData);

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

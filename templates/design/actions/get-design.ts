import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Get a design project by ID. Returns the full design data including all associated files.",
  schema: z.object({
    id: z.string().describe("Design ID"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = await resolveAccess("design", id);
    if (!access) {
      return "Error: Design not found";
    }

    const row = access.resource;
    const db = getDb();

    // Fetch associated files
    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      projectType: row.projectType,
      designSystemId: row.designSystemId,
      data: row.data ?? null,
      visibility: row.visibility,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      files: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        fileType: f.fileType,
        content: f.content,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
    };
  },
});

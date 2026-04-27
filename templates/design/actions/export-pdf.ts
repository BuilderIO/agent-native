import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Prepare design data for client-side PDF export. Returns the design data " +
    "and files needed for the client to render and generate a PDF.",
  schema: z.object({
    id: z.string().describe("Design ID to export"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = await resolveAccess("design", id);
    if (!access) throw new Error(`Design not found: ${id}`);

    const row = access.resource;
    const db = getDb();

    // Fetch all design files
    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      projectType: row.projectType,
      data: row.data ?? null,
      files: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        fileType: f.fileType,
        content: f.content,
      })),
      exportInfo: {
        format: "pdf",
        note: "Use client-side rendering (e.g. html2canvas + jsPDF) to generate the PDF from the returned design data.",
      },
    };
  },
});

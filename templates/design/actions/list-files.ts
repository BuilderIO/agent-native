import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "List all files for a design project. Requires read access to the design.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId }) => {
    // Verify access to the parent design
    const access = await resolveAccess("design", designId);
    if (!access) {
      return "Error: Design not found";
    }

    const db = getDb();
    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));

    return {
      count: files.length,
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

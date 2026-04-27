import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Export a design project as a ZIP file containing all design files and a README. " +
    "Returns the ZIP as a base64 string and suggested filename.",
  schema: z.object({
    id: z.string().describe("Design ID to export"),
  }),
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

    // Dynamic import JSZip
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    // Add README
    const readme = [
      `# ${row.title}`,
      "",
      row.description ? `${row.description}` : "",
      "",
      `Project Type: ${row.projectType}`,
      `Exported: ${new Date().toISOString()}`,
      "",
      "## Files",
      "",
      ...files.map((f) => `- ${f.filename} (${f.fileType})`),
    ].join("\n");

    zip.file("README.md", readme);

    // Add all design files organized by type
    for (const file of files) {
      const folder =
        file.fileType === "asset" ? "assets" : (file.fileType ?? "html");
      zip.file(`${folder}/${file.filename}`, file.content ?? "");
    }

    // Add design data if present
    if (row.data) {
      zip.file("design-data.json", row.data);
    }

    // Generate ZIP
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const zipBase64 = zipBuffer.toString("base64");

    // Save to exports directory
    const fs = await import("fs");
    const path = await import("path");
    const exportDir = path.join(process.cwd(), "data", "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const filename = `${row.title.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.zip`;
    const filePath = path.join(exportDir, filename);
    fs.writeFileSync(filePath, zipBuffer);

    return { zipBase64, filename, filePath, fileCount: files.length };
  },
});

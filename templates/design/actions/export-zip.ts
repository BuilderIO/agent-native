import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  exportFilename,
  trySaveExportFile,
} from "../server/lib/design-export.js";
import { isBoardFile } from "../shared/board-file.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

const METADATA_ARCHIVE_DIR = "agent-native-metadata";

function safeArchivePath(filename: string, fallback: string): string {
  const normalized = filename
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return normalized || fallback;
}

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
    const exportFiles = files.filter((file) => !isBoardFile(file.filename));

    // Dynamic import JSZip
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    // Add generated metadata under a reserved folder so valid design files named
    // README.md or design-data.json can still export at the project root.
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
      ...exportFiles.map((f) => `- ${f.filename} (${f.fileType})`),
    ].join("\n");

    zip.file(`${METADATA_ARCHIVE_DIR}/README.md`, readme);

    // Preserve design-relative paths so exported HTML keeps working with
    // sibling CSS/assets. Strip traversal segments defensively for legacy rows.
    for (const [index, file] of exportFiles.entries()) {
      const filename = safeArchivePath(
        file.filename,
        `design-file-${index + 1}.txt`,
      );
      zip.file(filename, file.content ?? "");
    }

    // Add design data if present
    if (row.data) {
      zip.file(`${METADATA_ARCHIVE_DIR}/design-data.json`, row.data);
    }

    // Generate ZIP
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const zipBase64 = zipBuffer.toString("base64");

    const filename = exportFilename(row.title, "zip");
    const saveResult = await trySaveExportFile(filename, zipBuffer);

    return {
      zipBase64,
      filename,
      ...saveResult,
      fileCount: exportFiles.length,
    };
  },
});

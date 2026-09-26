import { defineAction } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { designDataForAccessRole } from "../server/lib/design-data-access.js";
import {
  exportFilename,
  injectHiddenLayerExportStyle,
  trySaveExportFile,
} from "../server/lib/design-export.js";
import { isBoardFile } from "../shared/board-file.js";
import "../server/db/index.js";

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
  run: async ({ id }, ctx) => {
    const access = await resolveAccess("design", id);
    if (!access) throw new Error(`Design not found: ${id}`);

    const row = access.resource;
    const db = getDb();

    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));
    const exportFiles = files.filter((file) => !isBoardFile(file.filename));

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

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

    for (const [index, file] of exportFiles.entries()) {
      const filename = safeArchivePath(
        file.filename,
        `design-file-${index + 1}.txt`,
      );
      const content =
        file.fileType === "html"
          ? injectHiddenLayerExportStyle(file.content ?? "")
          : (file.content ?? "");
      zip.file(filename, content);
    }

    // but must never serialize a localhost bridge token into the archive.
    const exportDesignData = designDataForAccessRole(
      row.data ?? null,
      access.role,
    );
    if (typeof exportDesignData === "string") {
      zip.file(`${METADATA_ARCHIVE_DIR}/design-data.json`, exportDesignData);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const zipBase64 = zipBuffer.toString("base64");

    const filename = exportFilename(row.title, "zip");
    const saveResult = await trySaveExportFile(filename, zipBuffer);

    track(
      "design_exported",
      {
        app_name: "design",
        template_name: "design",
        output_id: id,
        output_type: "design",
        export_format: "zip",
        file_count: exportFiles.length,
      },
      ctx,
    );

    return {
      zipBase64,
      filename,
      ...saveResult,
      fileCount: exportFiles.length,
    };
  },
});

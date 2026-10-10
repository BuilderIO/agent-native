import { defineAction, fail } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  ExportLiveSourceError,
  loadLiveExportFiles,
} from "../server/lib/design-export-source.js";
import {
  buildStandaloneHtml,
  buildSvgForeignObject,
  exportFilename,
  trySaveExportFile,
} from "../server/lib/design-export.js";
import { isBoardFile } from "../shared/board-file.js";
import "../server/db/index.js";

export default defineAction({
  description:
    "Export a design project as an SVG document using a foreignObject wrapper around the standalone HTML. " +
    "The editor's Download SVG command uses the live browser DOM for the most faithful snapshot; this action provides agent parity for source-based SVG export.",
  schema: z.object({
    id: z.string().describe("Design ID to export"),
    width: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .default(1440)
      .describe("SVG viewport width in pixels"),
    height: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .default(1200)
      .describe("SVG viewport height in pixels"),
  }),
  readOnly: true,
  run: async ({ id, width, height }, ctx) => {
    const access = await resolveAccess("design", id);
    if (!access)
      fail("Design not found.", { errorCode: "not_found", statusCode: 404 });

    const row = access.resource;
    const db = getDb();

    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));
    let liveFiles: typeof files;
    try {
      liveFiles = await loadLiveExportFiles(files);
    } catch (error) {
      if (error instanceof ExportLiveSourceError)
        fail(error.message, {
          errorCode: error.actionErrorCode,
          statusCode: error.statusCode,
        });
      throw error;
    }
    const exportFiles = liveFiles.filter((file) => !isBoardFile(file.filename));

    const html = buildStandaloneHtml({
      title: row.title,
      files: exportFiles,
      screenLayout: "merged",
    });
    const svg = buildSvgForeignObject({
      html,
      width,
      height,
      title: row.title,
    });
    const filename = exportFilename(row.title, "svg");
    const saveResult = await trySaveExportFile(filename, svg);

    track(
      "design_exported",
      {
        app_name: "design",
        template_name: "design",
        output_id: id,
        output_type: "design",
        export_format: "svg",
        file_count: exportFiles.length,
      },
      ctx,
    );

    return { svg, filename, ...saveResult, fileCount: exportFiles.length };
  },
});

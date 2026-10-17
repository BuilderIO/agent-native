import { defineAction } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  trackDesignExported,
  withDesignExportFailureTracking,
} from "../server/lib/design-export-tracking.js";
import {
  buildStandaloneHtml,
  buildSvgForeignObject,
  exportFilename,
  trySaveExportFile,
} from "../server/lib/design-export.js";
import { isBoardFile } from "../shared/board-file.js";
import "../server/db/index.js";

const trackSvgExportFailures = withDesignExportFailureTracking<{
  id: string;
  width: number;
  height: number;
}>("svg");

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
  run: trackSvgExportFailures(async ({ id, width, height }, ctx, facts) => {
    const access = await resolveAccess("design", id);
    if (!access) throw new Error(`Design not found: ${id}`);
    facts.designId = id;

    const row = access.resource;
    const db = getDb();

    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));
    const exportFiles = files.filter((file) => !isBoardFile(file.filename));
    facts.fileCount = exportFiles.length;

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

    trackDesignExported(
      { ...facts, exportFormat: "svg", status: "completed" },
      ctx,
    );

    return { svg, filename, ...saveResult, fileCount: exportFiles.length };
  }),
});

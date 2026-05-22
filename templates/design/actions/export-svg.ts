import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import {
  buildStandaloneHtml,
  buildSvgForeignObject,
  exportFilename,
  trySaveExportFile,
} from "../server/lib/design-export.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

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
  run: async ({ id, width, height }) => {
    const access = await resolveAccess("design", id);
    if (!access) throw new Error(`Design not found: ${id}`);

    const row = access.resource;
    const db = getDb();

    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));

    const html = buildStandaloneHtml({ title: row.title, files });
    const svg = buildSvgForeignObject({
      html,
      width,
      height,
      title: row.title,
    });
    const filename = exportFilename(row.title, "svg");
    const saveResult = await trySaveExportFile(filename, svg);

    return { svg, filename, ...saveResult, fileCount: files.length };
  },
});

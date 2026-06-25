import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  buildStandaloneHtml,
  exportFilename,
  trySaveExportFile,
} from "../server/lib/design-export.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Export a design project as a standalone HTML file with Tailwind CSS and Alpine.js included via CDN. " +
    "Bundles all HTML, CSS, and JSX files into a single self-contained page. " +
    "Returns the HTML string and suggested filename.",
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

    const html = buildStandaloneHtml({ title: row.title, files });

    const filename = exportFilename(row.title, "html");
    const saveResult = await trySaveExportFile(filename, html);

    return { html, filename, ...saveResult, fileCount: files.length };
  },
});

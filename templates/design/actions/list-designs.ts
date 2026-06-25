import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { desc, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

// Truncate preview HTML so the listing payload stays reasonable. The home
// screen only needs enough HTML to render a recognizable thumbnail; full
// content loads on demand when the user opens an editor.
const PREVIEW_MAX_BYTES = 50_000;

export default defineAction({
  description:
    "List all design projects accessible to the current user. " +
    "Returns title, id, project type, and timestamps.",
  schema: z.object({
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' for compact output (id, title, projectType only)",
      ),
    includePreview: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' to include a truncated `previewHtml` field per design (the index.html content). Used by the homepage to render thumbnails.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    // Project only the columns the list path uses. The `data` TEXT column holds
    // the full design JSON (tweaks, selections, etc.) which can be large and is
    // never read on the listing — detail/editor views load it via get-design.
    const rows = await db
      .select({
        id: schema.designs.id,
        title: schema.designs.title,
        description: schema.designs.description,
        projectType: schema.designs.projectType,
        designSystemId: schema.designs.designSystemId,
        visibility: schema.designs.visibility,
        createdAt: schema.designs.createdAt,
        updatedAt: schema.designs.updatedAt,
      })
      .from(schema.designs)
      .where(accessFilter(schema.designs, schema.designShares))
      .orderBy(desc(schema.designs.updatedAt));

    if (rows.length === 0) {
      return { count: 0, designs: [] };
    }

    // Look up one preview per design when requested. We pick the shortest
    // HTML file so the response stays small and the chosen file is more
    // likely to be the entry point (`index.html`) rather than a heavy
    // multi-page sub-screen. Falls back to the first HTML file we find.
    const previews = new Map<string, string>();
    if (args.includePreview === "true" && args.compact !== "true") {
      const ids = rows.map((r) => r.id);
      const fileRows = await db
        .select({
          designId: schema.designFiles.designId,
          filename: schema.designFiles.filename,
          content: schema.designFiles.content,
          fileType: schema.designFiles.fileType,
        })
        .from(schema.designFiles)
        .where(inArray(schema.designFiles.designId, ids));

      const byDesign = new Map<string, typeof fileRows>();
      for (const f of fileRows) {
        if (f.fileType !== "html") continue;
        const list = byDesign.get(f.designId);
        if (list) list.push(f);
        else byDesign.set(f.designId, [f]);
      }

      for (const [designId, files] of byDesign) {
        const indexFile =
          files.find((f) => f.filename === "index.html") ?? files[0];
        if (!indexFile?.content) continue;
        const trimmed =
          indexFile.content.length > PREVIEW_MAX_BYTES
            ? indexFile.content.slice(0, PREVIEW_MAX_BYTES)
            : indexFile.content;
        previews.set(designId, trimmed);
      }
    }

    const items = rows.map((row) => {
      if (args.compact === "true") {
        return {
          id: row.id,
          title: row.title,
          projectType: row.projectType,
        };
      }
      const base = {
        id: row.id,
        title: row.title,
        description: row.description,
        projectType: row.projectType,
        designSystemId: row.designSystemId,
        visibility: row.visibility,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      if (args.includePreview === "true") {
        return { ...base, previewHtml: previews.get(row.id) ?? null };
      }
      return base;
    });

    return { count: items.length, designs: items };
  },
});

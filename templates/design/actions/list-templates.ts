import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { STARTER_TEMPLATES } from "../shared/starter-templates.js";
import { PREVIEW_MAX_BYTES } from "./list-designs.js";

export default defineAction({
  description:
    "List reusable design templates accessible to the current user, plus the " +
    "built-in template definitions. Use before creating a design when " +
    "the user references a saved template or past work.",
  schema: z.object({
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' for compact output (id, title, designSystemId, screenCount only)",
      ),
    includePreview: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' to include a truncated `previewHtml` field per template.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const builtInTemplates = STARTER_TEMPLATES.map(
      ({ seedScreens, previewHtml: _previewHtml, ...starter }) => ({
        ...starter,
        hasSeedScreens: Boolean(seedScreens?.length),
        screenCount: seedScreens?.length ?? 0,
      }),
    );

    const rows = await db
      .select({
        id: schema.designs.id,
        title: schema.designs.title,
        description: schema.designs.description,
        projectType: schema.designs.projectType,
        designSystemId: schema.designs.designSystemId,
        visibility: schema.designs.visibility,
        templateMeta: schema.designs.templateMeta,
        createdAt: schema.designs.createdAt,
        updatedAt: schema.designs.updatedAt,
      })
      .from(schema.designs)
      .where(
        and(
          accessFilter(schema.designs, schema.designShares),
          eq(schema.designs.isTemplate, true),
        ),
      )
      .orderBy(desc(schema.designs.updatedAt));

    if (rows.length === 0) {
      return { builtInTemplates, count: 0, templates: [] };
    }

    const ids = rows.map((row) => row.id);
    const screenRows = await db
      .select({
        designId: schema.designFiles.designId,
        value: count(),
      })
      .from(schema.designFiles)
      .where(
        and(
          inArray(schema.designFiles.designId, ids),
          eq(schema.designFiles.fileType, "html"),
        ),
      )
      .groupBy(schema.designFiles.designId);
    const screenCounts = new Map(
      screenRows.map((row) => [row.designId, row.value]),
    );

    const previews = new Map<string, string>();
    if (args.includePreview === "true" && args.compact !== "true") {
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
      for (const file of fileRows) {
        if (file.fileType !== "html") continue;
        const list = byDesign.get(file.designId);
        if (list) list.push(file);
        else byDesign.set(file.designId, [file]);
      }

      for (const [designId, files] of byDesign) {
        const indexFile =
          files.find((file) => file.filename === "index.html") ?? files[0];
        if (!indexFile?.content) continue;
        previews.set(
          designId,
          indexFile.content.length > PREVIEW_MAX_BYTES
            ? indexFile.content.slice(0, PREVIEW_MAX_BYTES)
            : indexFile.content,
        );
      }
    }

    const templates = rows.map((row) => {
      const screenCount = screenCounts.get(row.id) ?? 0;
      if (args.compact === "true") {
        return {
          id: row.id,
          title: row.title,
          designSystemId: row.designSystemId,
          screenCount,
        };
      }
      const base = {
        id: row.id,
        title: row.title,
        description: row.description,
        projectType: row.projectType,
        designSystemId: row.designSystemId,
        visibility: row.visibility,
        templateMeta: row.templateMeta,
        screenCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      if (args.includePreview === "true") {
        return { ...base, previewHtml: previews.get(row.id) ?? null };
      }
      return base;
    });

    return { builtInTemplates, count: templates.length, templates };
  },
});

import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { serializeTemplate } from "./_helpers.js";
import { accessibleTemplateFilter } from "./_template-access.js";

export default defineAction({
  description:
    "List accessible reusable asset templates, globally or for a Brand Kit.",
  schema: z.object({
    libraryId: z.string().optional(),
    collectionId: z.string().optional(),
    scope: z.enum(["all", "global", "library"]).default("all"),
    query: z.string().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ libraryId, collectionId, scope, query }) => {
    const filters = [await accessibleTemplateFilter()];
    if (scope === "global") {
      filters.push(isNull(schema.assetTemplates.libraryId));
    } else if (scope === "library") {
      if (!libraryId) return { count: 0, templates: [] };
      filters.push(eq(schema.assetTemplates.libraryId, libraryId));
    } else if (libraryId) {
      filters.push(
        or(
          eq(schema.assetTemplates.libraryId, libraryId),
          isNull(schema.assetTemplates.libraryId),
        )!,
      );
    }
    if (collectionId)
      filters.push(
        or(
          eq(schema.assetTemplates.collectionId, collectionId),
          isNull(schema.assetTemplates.collectionId),
        )!,
      );
    const rows = await getDb()
      .select()
      .from(schema.assetTemplates)
      .where(filters.length === 1 ? filters[0] : and(...filters))
      .orderBy(
        asc(schema.assetTemplates.sortOrder),
        asc(schema.assetTemplates.title),
      );
    const libraryIds = [
      ...new Set(rows.flatMap((row) => (row.libraryId ? [row.libraryId] : []))),
    ];
    const libraries = libraryIds.length
      ? await getDb()
          .select({
            id: schema.assetLibraries.id,
            title: schema.assetLibraries.title,
          })
          .from(schema.assetLibraries)
          .where(
            and(
              inArray(schema.assetLibraries.id, libraryIds),
              accessFilter(schema.assetLibraries, schema.assetLibraryShares),
            ),
          )
      : [];
    const libraryTitleById = new Map(
      libraries.map((library) => [library.id, library.title]),
    );
    const normalizedQuery = query?.trim().toLowerCase();
    const templates = rows
      .map((row) =>
        serializeTemplate({
          ...row,
          libraryTitle: row.libraryId
            ? (libraryTitleById.get(row.libraryId) ?? null)
            : null,
        }),
      )
      .filter(
        (row) =>
          !normalizedQuery ||
          [row.title, row.description, row.category].some((value) =>
            value?.toLowerCase().includes(normalizedQuery),
          ),
      );
    return { count: templates.length, templates };
  },
});

import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import {
  buildContentSourceBundle,
  serializeContentSourceDocument,
  type ContentSourceDocument,
} from "../shared/content-source.js";

export default defineAction({
  description:
    "Export editable Content documents as source-control friendly Markdown/MDX files with frontmatter.",
  schema: z.object({
    sourceId: z
      .string()
      .optional()
      .describe(
        "Connected local-folder source to export using its relative paths",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Export Content Source",
    description:
      "Export Content documents as a local-file source bundle for MDX workflows.",
  },
  run: async ({ sourceId }) => {
    const db = getDb();
    const sourceRows = sourceId
      ? await db
          .select()
          .from(schema.contentDatabaseSourceRows)
          .where(eq(schema.contentDatabaseSourceRows.sourceId, sourceId))
      : [];
    const sourceDocumentIds = sourceRows.map((row) => row.documentId);
    const rows = await db
      .select()
      .from(schema.documents)
      .where(
        sourceId
          ? sourceDocumentIds.length
            ? and(
                accessFilter(schema.documents, schema.documentShares),
                inArray(schema.documents.id, sourceDocumentIds),
              )
            : eq(schema.documents.id, "__no_local_folder_documents__")
          : accessFilter(schema.documents, schema.documentShares),
      )
      .orderBy(asc(schema.documents.position), asc(schema.documents.title));

    const documents: ContentSourceDocument[] = rows.map((doc) => ({
      id: doc.id,
      parentId: doc.parentId,
      title: doc.title,
      content: doc.content,
      description: doc.description,
      icon: doc.icon,
      position: doc.position,
      isFavorite: parseDocumentFavorite(doc.isFavorite),
      hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
      visibility: doc.visibility,
      updatedAt: doc.updatedAt,
    }));

    if (sourceId) {
      const pathByDocumentId = new Map(
        sourceRows.map((row) => [row.documentId, row.sourceDisplayKey]),
      );
      return {
        root: "",
        exportedAt: new Date().toISOString(),
        files: Object.fromEntries(
          documents.map((document) => [
            pathByDocumentId.get(document.id) ?? `content/${document.id}.mdx`,
            serializeContentSourceDocument(document),
          ]),
        ),
        count: documents.length,
      };
    }
    return { ...buildContentSourceBundle(documents), count: documents.length };
  },
});

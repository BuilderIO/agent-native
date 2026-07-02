import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  documentDiscoveryFilter,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import { serializeDocumentSource } from "./_document-source.js";
import {
  isContentLocalFileMode,
  listLocalFileDocuments,
} from "./_local-file-documents.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

function makeSnippet(content: string, query: string, radius = 120) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const index = compact.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) {
    return compact.length <= radius * 2
      ? compact
      : `${compact.slice(0, radius * 2).trimEnd()}...`;
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(compact.length, index + query.length + radius);
  return `${start > 0 ? "..." : ""}${compact.slice(start, end).trim()}${
    end < compact.length ? "..." : ""
  }`;
}

export default defineAction({
  description:
    "Search documents by title and content. Returns metadata and snippets; use get-document for full content.",
  schema: z.object({
    query: z.string().describe("Search text"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    sourceScope: z
      .enum(["all", "database", "local-files"])
      .default("all")
      .describe(
        "Optional source scope. Use local-files for repo/local-file truth and database for SQL-backed pages.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const query = args.query;

    if (await isContentLocalFileMode()) {
      if (args.sourceScope === "database") {
        return { documents: [] };
      }
      const normalizedQuery = query.toLowerCase();
      const docs = (await listLocalFileDocuments())
        .filter((doc) => doc.source?.kind !== "folder")
        .filter((doc) => !doc.hideFromSearch)
        .filter(
          (doc) =>
            !normalizedQuery ||
            doc.title.toLowerCase().includes(normalizedQuery) ||
            doc.content.toLowerCase().includes(normalizedQuery),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, args.limit);

      return {
        documents: docs.map((doc) => ({
          id: doc.id,
          parentId: doc.parentId,
          title: doc.title,
          icon: doc.icon,
          snippet: makeSnippet(doc.content, query),
          contentLength: doc.content.length,
          hideFromSearch: doc.hideFromSearch,
          source: doc.source,
          updatedAt: doc.updatedAt,
        })),
      };
    }

    const db = getDb();
    const pattern = `%${escapeLike(query)}%`;

    const docs = await db
      .select({
        id: schema.documents.id,
        parentId: schema.documents.parentId,
        title: schema.documents.title,
        icon: schema.documents.icon,
        content: schema.documents.content,
        hideFromSearch: schema.documents.hideFromSearch,
        sourceMode: schema.documents.sourceMode,
        sourceKind: schema.documents.sourceKind,
        sourcePath: schema.documents.sourcePath,
        sourceRootPath: schema.documents.sourceRootPath,
        sourceUpdatedAt: schema.documents.sourceUpdatedAt,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(
        and(
          accessFilter(schema.documents, schema.documentShares),
          documentDiscoveryFilter(),
          args.sourceScope === "local-files"
            ? eq(schema.documents.sourceMode, "local-files")
            : args.sourceScope === "database"
              ? sql`(${schema.documents.sourceMode} IS NULL OR ${schema.documents.sourceMode} = 'database')`
              : undefined,
          sql`(${schema.documents.title} LIKE ${pattern} ESCAPE '\\' OR ${schema.documents.content} LIKE ${pattern} ESCAPE '\\')`,
        ),
      )
      .orderBy(sql`${schema.documents.updatedAt} DESC`)
      .limit(args.limit);

    return {
      documents: docs.map((doc) => ({
        id: doc.id,
        parentId: doc.parentId,
        title: doc.title,
        icon: doc.icon,
        snippet: makeSnippet(doc.content, query),
        contentLength: doc.content.length,
        hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
        source: serializeDocumentSource(doc),
        updatedAt: doc.updatedAt,
      })),
    };
  },
});

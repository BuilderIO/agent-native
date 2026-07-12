import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  documentDiscoveryFilter,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import {
  isContentLocalFileMode,
  listLocalFileDocuments,
} from "./_local-file-documents.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

// `content` here may be a bounded preview (see the `contentPreview`
// projection below) rather than the full document body. If the query match
// falls outside the preview window (a deeper match in the full doc, which the
// SQL LIKE filter already confirmed exists), `indexOf` simply misses and we
// fall back to a beginning-of-document snippet — the same behavior as the
// no-match case. The row is still returned either way.
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
  }),
  http: { method: "GET" },
  run: async (args) => {
    const query = args.query;

    if (await isContentLocalFileMode()) {
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
          updatedAt: doc.updatedAt,
        })),
      };
    }

    const db = getDb();
    const pattern = `%${escapeLike(query)}%`;

    // Project a bounded preview of `content` instead of the full column:
    // document bodies can be multi-MB, and this action only returns a short
    // snippet (use get-document for full content). 5000 chars is generous
    // headroom for `makeSnippet`'s 120-char radius even when the match is
    // deep-ish into the doc, while the true length still comes from SQL
    // `length()` rather than reading `.length` off a truncated string.
    // Mirrors the `substr`/`length` projection style in list-documents.ts.
    // Both `substr` and `length` work identically on SQLite/libsql and
    // Postgres.
    const docs = await db
      .select({
        id: schema.documents.id,
        parentId: schema.documents.parentId,
        title: schema.documents.title,
        icon: schema.documents.icon,
        contentPreview: sql<string>`substr(${schema.documents.content}, 1, 5000)`,
        contentLength: sql<number>`length(${schema.documents.content})`,
        hideFromSearch: schema.documents.hideFromSearch,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(
        and(
          accessFilter(schema.documents, schema.documentShares),
          documentDiscoveryFilter(),
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
        snippet: makeSnippet(doc.contentPreview, query),
        contentLength: Number(doc.contentLength) || 0,
        hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
        updatedAt: doc.updatedAt,
      })),
    };
  },
});

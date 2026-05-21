import { defineAction } from "@agent-native/core";
import { and, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";
import {
  documentDiscoveryFilter,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import { z } from "zod";

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
  }),
  http: { method: "GET" },
  run: async (args) => {
    const query = args.query;

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

    if (docs.length === 0) {
      console.log(`No documents matching "${query}".`);
      return { documents: [] };
    }

    console.log(`Found ${docs.length} document(s) matching "${query}"`);
    return {
      documents: docs.map((doc) => ({
        id: doc.id,
        parentId: doc.parentId,
        title: doc.title,
        icon: doc.icon,
        snippet: makeSnippet(doc.content, query),
        contentLength: doc.content.length,
        hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
        updatedAt: doc.updatedAt,
      })),
    };
  },
});

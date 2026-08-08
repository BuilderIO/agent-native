import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { asc, desc, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseDocumentHideFromSearch } from "../server/lib/documents.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import {
  DOCUMENT_DISCOVERY_DEFAULT_LIMIT,
  DOCUMENT_DISCOVERY_MAX_LIMIT,
  documentDiscoveryPagination,
  documentDiscoveryWhere,
} from "./_document-discovery-query.js";

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
    "Search one bounded page of access-scoped documents by title and content, or find an exact title within a parent, space, and document type. Returns explicit pagination; follow nextOffset until hasMore is false. Returns metadata and snippets; use get-document for full content.",
  schema: z
    .object({
      query: z.string().trim().min(1).optional().describe("Search text"),
      exactTitle: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Case-sensitive exact document title"),
      parentId: z
        .string()
        .nullable()
        .optional()
        .describe("Exact parent document ID; null selects roots"),
      spaceId: z.string().min(1).optional().describe("Exact Content space ID"),
      documentType: z
        .enum(["page", "database"])
        .optional()
        .describe("Only ordinary pages or database pages"),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(DOCUMENT_DISCOVERY_MAX_LIMIT)
        .default(DOCUMENT_DISCOVERY_DEFAULT_LIMIT)
        .describe("Maximum documents returned in this page"),
      offset: z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Zero-based continuation offset"),
    })
    .refine(
      (args) => args.query !== undefined || args.exactTitle !== undefined,
      {
        message: "Provide query or exactTitle.",
      },
    ),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const userEmail = getRequestUserEmail();
    const activeOrgId = getRequestOrgId();
    const memberships = userEmail
      ? await listContentOrganizationMemberships(userEmail)
      : [];
    const authorizedOrgIds = [
      ...new Set([
        ...memberships.map((membership) => membership.orgId),
        ...(!userEmail && activeOrgId ? [activeOrgId] : []),
      ]),
    ];
    const pattern = args.query ? `%${escapeLike(args.query)}%` : undefined;
    const where = documentDiscoveryWhere({
      userEmail,
      authorizedOrgIds,
      exactTitle: args.exactTitle,
      parentId: args.parentId,
      spaceId: args.spaceId,
      documentType: args.documentType,
      additional: pattern
        ? sql`(${schema.documents.title} LIKE ${pattern} ESCAPE '\\' OR ${schema.documents.description} LIKE ${pattern} ESCAPE '\\' OR ${schema.documents.content} LIKE ${pattern} ESCAPE '\\')`
        : undefined,
    });
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.documents)
      .where(where);
    const totalItems = Number(countRow?.count ?? 0);

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
        description: schema.documents.description,
        icon: schema.documents.icon,
        contentPreview: sql<string>`substr(${schema.documents.content}, 1, 5000)`,
        contentLength: sql<number>`length(${schema.documents.content})`,
        hideFromSearch: schema.documents.hideFromSearch,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(where)
      .orderBy(desc(schema.documents.updatedAt), asc(schema.documents.id))
      .limit(args.limit)
      .offset(args.offset);

    return {
      documents: docs.map((doc) => ({
        id: doc.id,
        parentId: doc.parentId,
        title: doc.title,
        description: doc.description,
        icon: doc.icon,
        snippet: makeSnippet(
          doc.contentPreview,
          args.query ?? args.exactTitle ?? "",
        ),
        contentLength: Number(doc.contentLength) || 0,
        hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
        updatedAt: doc.updatedAt,
      })),
      pagination: documentDiscoveryPagination({
        offset: args.offset,
        limit: args.limit,
        totalItems,
        returnedItems: docs.length,
      }),
    };
  },
});

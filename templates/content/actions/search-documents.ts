import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseDocumentHideFromSearch } from "../server/lib/documents.js";
import {
  parseSearchQuery,
  type SearchQueryTerm,
} from "../shared/search-query.js";
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
    'Search one bounded page of access-scoped documents by title and content, or find an exact title within a parent, space, and document type. The query supports Google-style operators: "exact phrase", -excludedTerm, OR between terms (uppercase), intitle:term; bare words combine with AND and %, _ match literally. Returns explicit pagination; follow nextOffset until hasMore is false. Returns metadata and snippets; use get-document for full content.',
  deferLoading: false,
  mcpTool: true,
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
      searchFields: z
        .enum(["all", "title"])
        .optional()
        .describe("Match title only, or title, description and body (default)"),
      modifiedAfter: z.iso
        .datetime()
        .optional()
        .describe("Modified at or after this UTC timestamp"),
      modifiedBefore: z.iso
        .datetime()
        .optional()
        .describe("Modified before this UTC timestamp"),
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
    let snippetNeedle = args.exactTitle ?? "";
    const queryTermPredicate = (term: SearchQueryTerm): SQL => {
      const pattern = `%${escapeLike(term.text)}%`;
      const columns =
        args.searchFields === "title" || term.titleOnly
          ? [schema.documents.title]
          : [
              schema.documents.title,
              schema.documents.description,
              schema.documents.content,
            ];
      return or(
        ...columns.map((column) => sql`${column} ILIKE ${pattern} ESCAPE '\\'`),
      )!;
    };
    const matchPredicates: SQL[] = [];
    if (args.query) {
      const parsed = parseSearchQuery(args.query);
      if (parsed.empty) {
        // Punctuation-only input (lone `-`, empty quotes) matches nothing by
        // design; report that as a loud empty page rather than every document.
        matchPredicates.push(sql`false`);
      } else {
        for (const group of parsed.groups) {
          matchPredicates.push(or(...group.terms.map(queryTermPredicate))!);
        }
        for (const negative of parsed.negatives) {
          matchPredicates.push(sql`NOT ${queryTermPredicate(negative)}`);
        }
      }
      snippetNeedle = parsed.groups[0]?.terms[0]?.text ?? args.query;
    }
    const where = documentDiscoveryWhere({
      userEmail,
      authorizedOrgIds,
      exactTitle: args.exactTitle,
      parentId: args.parentId,
      spaceId: args.spaceId,
      documentType: args.documentType,
      additional: and(
        args.query
          ? or(
              eq(schema.documents.hideFromSearch, 0),
              isNull(schema.documents.hideFromSearch),
            )
          : undefined,
        ...matchPredicates,
        // updatedAt is a text column holding both ISO "T"-separated values and
        // PostgreSQL "space"-separated defaults, so it must be compared as a
        // timestamp; a lexical compare drops valid rows at page boundaries.
        args.modifiedAfter
          ? gte(
              sql`${schema.documents.updatedAt}::timestamptz`,
              args.modifiedAfter,
            )
          : undefined,
        args.modifiedBefore
          ? lt(
              sql`${schema.documents.updatedAt}::timestamptz`,
              args.modifiedBefore,
            )
          : undefined,
      ),
    });
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.documents)
      .where(where);
    const totalItems = Number(countRow?.count ?? 0);

    // Project a bounded preview of `content` instead of the full column:
    // document bodies can be multi-MB, and this action only returns a short
    // snippet (use get-document for full content). In free-text mode the
    // preview window is anchored at the first in-body occurrence of the first
    // match needle, so a hit deeper than any fixed head window still shows
    // its own context (`makeSnippet` re-locates the needle inside the
    // window); title-only matches and exactTitle mode keep the head
    // projection. The true length still comes from SQL `length()` rather than
    // reading `.length` off a truncated string. Mirrors the
    // `substr`/`length` projection style in list-documents.ts; `position`,
    // `substr`, and `length` all work in PostgreSQL and PGlite.
    const matchWindow = snippetNeedle
      ? sql<string>`case when position(lower(${snippetNeedle}) in lower(${schema.documents.content})) > 0 then substr(${schema.documents.content}, greatest(1, position(lower(${snippetNeedle}) in lower(${schema.documents.content})) - 120), 240 + length(${snippetNeedle})) else substr(${schema.documents.content}, 1, 5000) end`
      : sql<string>`substr(${schema.documents.content}, 1, 5000)`;
    const docs = await db
      .select({
        id: schema.documents.id,
        parentId: schema.documents.parentId,
        title: schema.documents.title,
        description: schema.documents.description,
        icon: schema.documents.icon,
        contentPreview: matchWindow,
        contentLength: sql<number>`length(${schema.documents.content})`,
        hideFromSearch: schema.documents.hideFromSearch,
        updatedAt: schema.documents.updatedAt,
        sourceKind: schema.documents.sourceKind,
        sourceUpdatedAt: schema.documents.sourceUpdatedAt,
        documentType: sql<"page" | "database">`case when ${exists(
          db
            .select({ id: schema.contentDatabases.id })
            .from(schema.contentDatabases)
            .where(
              and(
                eq(schema.contentDatabases.documentId, schema.documents.id),
                isNull(schema.contentDatabases.deletedAt),
              ),
            ),
        )} then 'database' else 'page' end`,
      })
      .from(schema.documents)
      .where(where)
      .orderBy(desc(schema.documents.updatedAt), asc(schema.documents.id))
      .limit(args.limit)
      .offset(args.offset);

    const parentIds = [
      ...new Set(docs.flatMap((doc) => (doc.parentId ? [doc.parentId] : []))),
    ];
    const parents = parentIds.length
      ? await db
          .select({ id: schema.documents.id, title: schema.documents.title })
          .from(schema.documents)
          .where(
            documentDiscoveryWhere({
              userEmail,
              authorizedOrgIds,
              spaceId: args.spaceId,
              additional: inArray(schema.documents.id, parentIds),
            }),
          )
      : [];
    const parentById = new Map(parents.map((parent) => [parent.id, parent]));

    return {
      documents: docs.map((doc) => ({
        id: doc.id,
        parentId:
          doc.parentId && parentById.has(doc.parentId) ? doc.parentId : null,
        parentTitle: doc.parentId
          ? (parentById.get(doc.parentId)?.title ?? null)
          : null,
        documentType: doc.documentType,
        sourceKind: doc.sourceKind,
        sourceUpdatedAt: doc.sourceUpdatedAt,
        title: doc.title,
        description: doc.description,
        icon: doc.icon,
        snippet: makeSnippet(doc.contentPreview, snippetNeedle),
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

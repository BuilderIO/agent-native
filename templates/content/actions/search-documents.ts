import { defineAction } from "@agent-native/core/action";
import {
  indexedSearchSql,
  prepareSearchIndex,
  SearchTermTooLongError,
  type IndexedSearchSql,
} from "@agent-native/core/search";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
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
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { documentSearchIndex, getDb, schema } from "../server/db/index.js";
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
import { loadDocumentSearchPreviews } from "./_document-search-preview.js";
import { documentSearchRanking } from "./_document-search-ranking.js";
import { loadPageSubtree, searchSubtreeDocumentIds } from "./_page-subtree.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

export default defineAction({
  description:
    'Search one relevance-ranked, bounded page of access-scoped documents by title and content, or find an exact title within a parent, space, and document type. Exact and partial title matches rank above description and body matches. Titles and descriptions match anywhere; body text matches from the start of words. The query supports Google-style operators: "exact phrase", -excludedTerm, OR between terms (uppercase), intitle:term; bare words combine with AND and %, _ match literally. Returns explicit pagination; follow nextOffset until hasMore is false. Returns metadata and snippets; use get-document for full content.',
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
      excludeSubtreeOf: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Leave out this document and every page beneath it, e.g. to list valid new parents when moving it",
        ),
      withinSubtreeOf: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Search only this document and everything inside it: its sub-pages, its collections and their rows",
        ),
      documentType: z
        .enum(["page", "database"])
        .optional()
        .describe("Only ordinary pages or collection pages"),
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
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
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
    let bodyNeedles: string[] = [];
    let parsedQuery: ReturnType<typeof parseSearchQuery> | null = null;
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
      parsedQuery = parsed;
      if (parsed.empty) {
        matchPredicates.push(sql`false`);
      } else {
        for (const group of parsed.groups) {
          matchPredicates.push(or(...group.terms.map(queryTermPredicate))!);
        }
        for (const negative of parsed.negatives) {
          matchPredicates.push(sql`NOT ${queryTermPredicate(negative)}`);
        }
      }
      if (!args.exactTitle && args.searchFields !== "title") {
        bodyNeedles = [
          ...new Set(
            parsed.groups.flatMap((group) =>
              group.terms
                .filter((term) => !term.titleOnly)
                .map((term) => term.text),
            ),
          ),
        ].slice(0, 256);
      }
    }
    let excludedIds: string[] = [];
    if (args.excludeSubtreeOf) {
      const [excludedRoot] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, args.excludeSubtreeOf));
      excludedIds = excludedRoot
        ? (
            await loadPageSubtree(db, excludedRoot, {
              includeTrashed: false,
              requireComplete: false,
            })
          ).map((document) => document.id)
        : [args.excludeSubtreeOf];
    }
    let withinIds: string[] | null = null;
    if (args.withinSubtreeOf) {
      await assertAccess("document", args.withinSubtreeOf, "viewer");
      withinIds = await searchSubtreeDocumentIds(db, args.withinSubtreeOf);
    }
    // The core index answers when it is complete and current and the query
    // fits it; otherwise this request scans documents directly, as search
    // did before the index.
    let indexedSearch: IndexedSearchSql | null = null;
    if (parsedQuery && !parsedQuery.empty) {
      try {
        indexedSearch = indexedSearchSql({
          registration: documentSearchIndex,
          query: parsedQuery,
          fields: args.searchFields === "title" ? "title" : "all",
        });
      } catch (error) {
        if (!(error instanceof SearchTermTooLongError)) throw error;
      }
      if (
        indexedSearch &&
        !(await prepareSearchIndex(documentSearchIndex)).ready
      ) {
        indexedSearch = null;
      }
    }
    const baseWhere = documentDiscoveryWhere({
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
        excludedIds.length > 0
          ? notInArray(schema.documents.id, excludedIds)
          : undefined,
        withinIds ? inArray(schema.documents.id, withinIds) : undefined,
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
    const where = indexedSearch
      ? and(baseWhere, indexedSearch.match)
      : and(baseWhere, ...matchPredicates);
    const normalizedContent = sql<string>`coalesce(${schema.documents.content}, '')`;
    const ranking =
      !indexedSearch && parsedQuery?.groups.length
        ? documentSearchRanking(
            parsedQuery,
            {
              title: schema.documents.title,
              description: schema.documents.description,
              content: normalizedContent,
            },
            {
              includeNonTitleFields: args.searchFields !== "title",
            },
          )
        : null;
    let docsQuery = db
      .select({
        id: schema.documents.id,
        parentId: schema.documents.parentId,
        title: schema.documents.title,
        description: schema.documents.description,
        icon: schema.documents.icon,
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
        totalItems: sql<number>`count(*) over()`,
      })
      .from(schema.documents)
      .where(where)
      .$dynamic();
    // Reassigned because a new process's database handle replays a query from
    // its chained steps, so a join added on the side is lost.
    if (indexedSearch) {
      docsQuery = docsQuery.innerJoin(indexedSearch.join, indexedSearch.on);
    }
    const docs = await docsQuery
      .orderBy(
        ...(indexedSearch
          ? indexedSearch.orderBy
          : ranking
            ? [
                desc(ranking.matchTier),
                desc(ranking.titleCoverage),
                desc(ranking.descriptionCoverage),
                desc(
                  sql<number>`case when count(*) over() <= 1000 then ${ranking.bodyProximity} else 0 end`,
                ),
              ]
            : []),
        desc(schema.documents.updatedAt),
        asc(schema.documents.id),
      )
      .limit(args.limit)
      .offset(args.offset);
    const previewById = await loadDocumentSearchPreviews({
      db,
      where: baseWhere,
      ids: docs.map((doc) => doc.id),
      needles: bodyNeedles,
    });
    let countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.documents)
      .where(where)
      .$dynamic();
    if (indexedSearch) {
      countQuery = countQuery.innerJoin(indexedSearch.join, indexedSearch.on);
    }
    let totalItems: number;
    if (docs.length) {
      totalItems = Number(docs[0]!.totalItems);
    } else {
      const [counted] = await countQuery;
      // guard:allow-bare-error — invariant: count(*) without GROUP BY always returns one row.
      if (!counted) throw new Error("Counting search results returned no row.");
      totalItems = Number(counted.count);
    }

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
      documents: docs.map((doc) => {
        const preview = previewById.get(doc.id);
        return {
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
          snippet: preview?.snippet ?? "",
          contentLength: preview?.contentLength ?? 0,
          hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
          updatedAt: doc.updatedAt,
        };
      }),
      pagination: documentDiscoveryPagination({
        offset: args.offset,
        limit: args.limit,
        totalItems,
        returnedItems: docs.length,
      }),
    };
  },
});

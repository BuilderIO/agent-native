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
  notInArray,
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
import {
  documentSearchRanking,
  searchQueryProximityPattern,
} from "./_document-search-ranking.js";
import { loadPageSubtree } from "./_page-subtree.js";

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
  const compactQuery = query.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (!compactQuery) {
    return compact.length <= radius * 2
      ? compact
      : `${compact.slice(0, radius * 2).trimEnd()}...`;
  }
  const index = compact.toLowerCase().indexOf(compactQuery.toLowerCase());
  if (index < 0) {
    return compact.length <= radius * 2
      ? compact
      : `${compact.slice(0, radius * 2).trimEnd()}...`;
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(compact.length, index + compactQuery.length + radius);
  return `${start > 0 ? "..." : ""}${compact.slice(start, end).trim()}${
    end < compact.length ? "..." : ""
  }`;
}

export default defineAction({
  description:
    'Search one relevance-ranked, bounded page of access-scoped documents by title and content, or find an exact title within a parent, space, and document type. Exact and partial title matches rank above description and body matches. The query supports Google-style operators: "exact phrase", -excludedTerm, OR between terms (uppercase), intitle:term; bare words combine with AND and %, _ match literally. Returns explicit pagination; follow nextOffset until hasMore is false. Returns metadata and snippets; use get-document for full content.',
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
            await loadPageSubtree(db, excludedRoot, { includeTrashed: false })
          ).map((document) => document.id)
        : [args.excludeSubtreeOf];
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
        excludedIds.length > 0
          ? notInArray(schema.documents.id, excludedIds)
          : undefined,
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
    // Project a bounded preview of `content` instead of the full column:
    // document bodies can be multi-MB, and this action only returns a short
    // snippet (use get-document for full content). In free-text mode the
    // preview window is anchored at an in-body occurrence that keeps the most
    // eligible positive terms in view. The selected term is projected with the
    // window so `makeSnippet` preserves the complete match. Position and query
    // order break ties;
    // title-only matches and exactTitle mode keep the head projection. The
    // true length still comes from SQL `length()` rather than reading `.length`
    // off a truncated string. Mirrors the
    // `substr`/`length` projection style in list-documents.ts; `position`,
    // `substr`, and `length` all work in PostgreSQL and PGlite.
    const normalizedContent = sql<string>`coalesce(${schema.documents.content}, '')`;
    const bodyNeedleArray = bodyNeedles.length
      ? sql`array[${sql.join(
          bodyNeedles.map((needle) => sql`${needle}`),
          sql`, `,
        )}]::text[]`
      : undefined;
    const maxOccurrencesPerNeedle = Math.max(
      1,
      Math.floor(256 / Math.max(1, bodyNeedles.length)),
    );
    const proximityPattern =
      bodyNeedleArray && parsedQuery
        ? searchQueryProximityPattern(parsedQuery)
        : null;
    const proximityPosition = proximityPattern
      ? sql<number>`regexp_instr(${normalizedContent}, ${proximityPattern}, 1, 1, 0, 'i')`
      : undefined;
    // Inspect repeated occurrences so the snippet can prefer a later,
    // denser passage. Cap each needle to keep pathological repeated-token
    // documents from turning one result preview into an unbounded scan.
    const fallbackBodyPosition =
      bodyNeedles.length === 1
        ? sql<number>`nullif(position(lower(${bodyNeedles[0]!}) in lower(${normalizedContent})), 0)`
        : bodyNeedleArray
          ? sql<number>`(
          with recursive body_occurrence(needle, query_order, match_position, occurrence_number) as (
            select candidate.needle, candidate.query_order,
              position(lower(candidate.needle) in lower(${normalizedContent})), 1
            from unnest(${bodyNeedleArray}) with ordinality as candidate(needle, query_order)
            where position(lower(candidate.needle) in lower(${normalizedContent})) > 0
            union all
            select occurrence.needle, occurrence.query_order,
              occurrence.match_position + position(
                lower(occurrence.needle)
                in substring(lower(${normalizedContent}) from occurrence.match_position + 1)
              ), occurrence.occurrence_number + 1
            from body_occurrence as occurrence
            where occurrence.occurrence_number < ${maxOccurrencesPerNeedle} and position(
              lower(occurrence.needle)
              in substring(lower(${normalizedContent}) from occurrence.match_position + 1)
            ) > 0
          )
          select candidate.match_position
          from body_occurrence as candidate
          order by (
            select count(*)
            from unnest(${bodyNeedleArray}) as nearby(needle)
            where position(
              lower(nearby.needle)
              in lower(substr(
                ${normalizedContent},
                greatest(1, candidate.match_position - 120),
                240 + length(candidate.needle)
              ))
            ) > 0
          ) desc,
          candidate.match_position,
          candidate.query_order
          limit 1
        )`
          : undefined;
    const selectedBodyPosition =
      proximityPosition && fallbackBodyPosition
        ? sql<number>`coalesce(nullif(${proximityPosition}, 0), ${fallbackBodyPosition})`
        : fallbackBodyPosition;
    const selectedBodyNeedle =
      bodyNeedleArray && selectedBodyPosition
        ? sql<string>`(
            select candidate.needle
            from unnest(${bodyNeedleArray}) with ordinality as candidate(needle, query_order)
            where lower(substr(${normalizedContent}, ${selectedBodyPosition}, length(candidate.needle))) = lower(candidate.needle)
            order by candidate.query_order
            limit 1
          )`
        : undefined;
    const matchWindow = selectedBodyPosition
      ? sql<string>`case when ${selectedBodyPosition} is not null then substr(${normalizedContent}, greatest(1, ${selectedBodyPosition} - 120), least(5000, 240 + coalesce(length(${selectedBodyNeedle}), 0))) else substr(${normalizedContent}, 1, 5000) end`
      : sql<string>`substr(${normalizedContent}, 1, 5000)`;
    const ranking = parsedQuery?.groups.length
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
    const docs = await db
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
      .orderBy(
        ...(ranking
          ? [
              desc(ranking.matchTier),
              desc(ranking.titleCoverage),
              desc(ranking.descriptionCoverage),
              // Phrase coherence is a minor body-only tie-breaker. Bound its
              // full-body scan so broad searches keep predictable latency;
              // protected field tiers still rank the complete result set.
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
    const previews = docs.length
      ? await db
          .select({
            id: schema.documents.id,
            contentPreview: matchWindow,
            snippetNeedle: selectedBodyNeedle
              ? sql<string>`coalesce(${selectedBodyNeedle}, '')`
              : sql<string>`''`,
            contentLength: sql<number>`length(${normalizedContent})`,
          })
          .from(schema.documents)
          .where(
            and(
              where,
              inArray(
                schema.documents.id,
                docs.map((doc) => doc.id),
              ),
            ),
          )
      : [];
    const previewById = new Map(
      previews.map((preview) => [preview.id, preview]),
    );
    const totalItems = docs.length
      ? Number(docs[0]!.totalItems)
      : Number(
          (
            await db
              .select({ count: sql<number>`count(*)` })
              .from(schema.documents)
              .where(where)
          )[0]?.count ?? 0,
        );

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
          snippet: makeSnippet(
            preview?.contentPreview ?? "",
            preview?.snippetNeedle ?? "",
          ),
          contentLength: Number(preview?.contentLength) || 0,
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

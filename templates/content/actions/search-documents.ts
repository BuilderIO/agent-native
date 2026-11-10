import { defineAction } from "@agent-native/core/action";
import {
  indexedSearchSql,
  prepareSearchIndex,
  reciprocalRankFusion,
  searchSemanticIndex,
  semanticSearcherAudienceIds,
  SearchTermTooLongError,
  type IndexedSearchSql,
  type SemanticSearchResult,
  type SemanticSearchUnavailableReason,
} from "@agent-native/core/search";
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

import { documentSearchIndex, getDb, schema } from "../server/db/index.js";
import { parseDocumentHideFromSearch } from "../server/lib/documents.js";
import { endsInHtmlComment } from "../shared/og-description.js";
import {
  parseSearchQuery,
  type ParsedSearchQuery,
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
import {
  correctSearchQueryTypos,
  hasCorrectableWord,
  searchVocabulary,
  type SpellingCorrection,
  TYPO_VOCABULARY_LIMIT,
} from "./_document-search-typo.js";
import { loadPageSubtree } from "./_page-subtree.js";
import { SNIPPET_WINDOW_CONTEXT, searchSnippet } from "./_search-snippet.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

/** How much of the page before a match window search reads for a comment. */
const COMMENT_SCAN_CHARS = 20_000;

/**
 * Whether a match window starts inside an HTML comment, from the text before it
 * when that has an open marker. A marker too far back to read counts as one.
 */
function startsInComment(beforeOpenMarker: string | null | undefined): boolean {
  if (!beforeOpenMarker) return false;
  return (
    !beforeOpenMarker.includes("<!--") || endsInHtmlComment(beforeOpenMarker)
  );
}

/**
 * A result's snippet from its match window. The window starts
 * `SNIPPET_WINDOW_CONTEXT` characters before the match, or at the top of the
 * page, and the database counts characters the way `Array.from` does.
 */
function previewSnippet(
  preview:
    | {
        contentPreview: string | null;
        snippetNeedle: string | null;
        matchPosition: number | null;
        contentLength: number | null;
        beforeOpenMarker: string | null;
      }
    | undefined,
): string {
  const window = preview?.contentPreview ?? "";
  const position = Number(preview?.matchPosition) || 0;
  const windowStart = Math.max(1, position - SNIPPET_WINDOW_CONTEXT);
  return searchSnippet(window, preview?.snippetNeedle ?? "", {
    clippedStart: windowStart > 1,
    clippedEnd:
      windowStart - 1 + Array.from(window).length <
      (Number(preview?.contentLength) || 0),
    startsInComment: startsInComment(preview?.beforeOpenMarker),
    matchOffset: position > 0 ? position - windowStart : undefined,
  });
}

/**
 * How many results from each lane hybrid search fuses: the depth the
 * question-search bake-off measured. Words past it follow the fused results.
 */
const LANE_DEPTH = 20;
/** Meaning matches read, so enough remain after access and filter checks. */
const SEMANTIC_CANDIDATES = 40;

type SemanticSkipReason =
  | "words-mode"
  | "exact-title"
  | "title-only"
  | "operators"
  | "empty-query";

/** Whether the meaning lane ran for a search, and why not when it didn't. */
type SemanticSearchStatus =
  | { status: "used" }
  | { status: "off" }
  | { status: "unavailable"; reason: SemanticSearchUnavailableReason }
  | { status: "skipped"; reason: SemanticSkipReason };

type MatchedBy = "words" | "meaning" | "both";

/**
 * Why a search is answered by words alone before the meaning lane is asked.
 * Operators, title-only and exact-title searches ask for literal matches.
 */
function semanticSkipReason(
  args: {
    mode?: "hybrid" | "words";
    exactTitle?: string;
    searchFields?: "all" | "title";
  },
  parsed: ParsedSearchQuery,
): SemanticSkipReason | null {
  if (args.mode === "words") return "words-mode";
  if (args.exactTitle !== undefined) return "exact-title";
  if (args.searchFields === "title") return "title-only";
  if (parsed.empty) return "empty-query";
  const usesOperators =
    parsed.negatives.length > 0 ||
    parsed.groups.some(
      (group) =>
        group.terms.length > 1 ||
        group.terms.some((term) => term.phrase || term.titleOnly),
    );
  return usesOperators ? "operators" : null;
}

function semanticStatus(result: SemanticSearchResult): SemanticSearchStatus {
  if (result.status === "unavailable") {
    return { status: "unavailable", reason: result.reason };
  }
  return { status: result.status };
}

export default defineAction({
  description:
    'Search one relevance-ranked, bounded page of access-scoped documents by title and content, or find an exact title within a parent, space, and document type. Exact and partial title matches rank above description and body matches. Titles and descriptions match anywhere; body text matches from the start of words. The query supports Google-style operators: "exact phrase", -excludedTerm, OR between terms (uppercase), intitle:term; bare words combine with AND and %, _ match literally. When nothing matches, each word of four or more letters that appears in no visible title or description is also matched as the closest words that do, and spellingCorrections lists them. By default a plain query also finds pages by meaning, so a question finds the page that answers it in other words: the best word and meaning matches are merged first, then the remaining word matches follow. Each result says whether it matched by words, meaning, or both, and semanticSearch says whether meaning was used. Pass mode "words" to match words only; operators, searchFields "title", and exactTitle always match words only. Returns explicit pagination; follow nextOffset until hasMore is false. Returns metadata and snippets; use get-document for full content.',
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
      mode: z
        .enum(["hybrid", "words"])
        .optional()
        .describe(
          "hybrid (default) finds pages by meaning as well as words; words matches words only",
        ),
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
    const parsedQuery = args.query ? parseSearchQuery(args.query) : null;
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
    // Read once per request, so the typo pass sees the same readiness.
    let indexReady: Promise<boolean> | undefined;
    const indexIsReady = () =>
      (indexReady ??= prepareSearchIndex(documentSearchIndex).then(
        (state) => state.ready,
      ));
    const searchPage = async (
      query: ParsedSearchQuery | null,
      window: {
        limit: number;
        offset: number;
        /** Leave out these pages, already shown. */
        excludeIds?: readonly string[];
        /** Only these pages, when non-empty. */
        onlyIds?: readonly string[];
      },
    ) => {
      const matchPredicates: SQL[] = [];
      let bodyNeedles: string[] = [];
      if (query) {
        if (query.empty) {
          matchPredicates.push(sql`false`);
        } else {
          for (const group of query.groups) {
            // A group with no terms would match nothing.
            matchPredicates.push(
              or(...group.terms.map(queryTermPredicate)) ?? sql`false`,
            );
          }
          for (const negative of query.negatives) {
            matchPredicates.push(sql`NOT ${queryTermPredicate(negative)}`);
          }
        }
        if (!args.exactTitle && args.searchFields !== "title") {
          bodyNeedles = [
            ...new Set(
              query.groups.flatMap((group) =>
                group.terms
                  .filter((term) => !term.titleOnly)
                  .map((term) => term.text),
              ),
            ),
          ].slice(0, 256);
        }
      }
      // The core index answers when it is complete and current and the query
      // fits it; otherwise this request scans documents directly, as search
      // did before the index.
      let indexedSearch: IndexedSearchSql | null = null;
      if (query && !query.empty) {
        try {
          indexedSearch = indexedSearchSql({
            registration: documentSearchIndex,
            query,
            fields: args.searchFields === "title" ? "title" : "all",
          });
        } catch (error) {
          if (!(error instanceof SearchTermTooLongError)) throw error;
        }
        if (indexedSearch && !(await indexIsReady())) {
          indexedSearch = null;
        }
      }
      const windowWhere = and(
        window.excludeIds?.length
          ? notInArray(schema.documents.id, [...window.excludeIds])
          : undefined,
        window.onlyIds?.length
          ? inArray(schema.documents.id, [...window.onlyIds])
          : undefined,
      );
      const where = indexedSearch
        ? and(baseWhere, windowWhere, indexedSearch.match)
        : and(baseWhere, windowWhere, ...matchPredicates);
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
        bodyNeedleArray && query ? searchQueryProximityPattern(query) : null;
      const proximityPosition = proximityPattern
        ? sql<number>`regexp_instr(${normalizedContent}, ${proximityPattern}, 1, 1, 0, 'i')`
        : undefined;
      const fallbackBodyPosition =
        bodyNeedles.length === 1
          ? sql<number>`nullif(position(lower(${bodyNeedles[0]}) in lower(${normalizedContent})), 0)`
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
      // The stored page around the match, with enough on each side to leave
      // text for the snippet once markup is stripped.
      const context = sql.raw(String(SNIPPET_WINDOW_CONTEXT));
      const matchWindow = selectedBodyPosition
        ? sql<string>`case when ${selectedBodyPosition} is not null then substr(${normalizedContent}, greatest(1, ${selectedBodyPosition} - ${context}), least(5000, 2 * ${context} + coalesce(length(${selectedBodyNeedle}), 0))) else substr(${normalizedContent}, 1, 5000) end`
        : sql<string>`substr(${normalizedContent}, 1, 5000)`;
      // The end of the page before the window, only when that text, read
      // backwards, reaches a `<!--` before any `-->`. The window can only start
      // inside a comment then, and the marker may still be code, which takes
      // Markdown to tell.
      const beforeWindow = selectedBodyPosition
        ? sql<string>`substr(${normalizedContent}, 1, greatest(0, ${selectedBodyPosition} - ${context} - 1))`
        : undefined;
      const beforeOpenMarker = beforeWindow
        ? sql<
            string | null
          >`case when strpos(reverse(${beforeWindow}), '--!<') > 0 and (strpos(reverse(${beforeWindow}), '>--') = 0 or strpos(reverse(${beforeWindow}), '--!<') < strpos(reverse(${beforeWindow}), '>--')) then right(${beforeWindow}, ${sql.raw(String(COMMENT_SCAN_CHARS))}) end`
        : sql<string | null>`null`;
      const ranking =
        !indexedSearch && query?.groups.length
          ? documentSearchRanking(
              query,
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
      const docsQuery = db
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
      if (indexedSearch) {
        docsQuery.innerJoin(indexedSearch.join, indexedSearch.on);
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
        .limit(window.limit)
        .offset(window.offset);
      const previews = docs.length
        ? await db
            .select({
              id: schema.documents.id,
              contentPreview: matchWindow,
              matchPosition: selectedBodyPosition ?? sql<number | null>`null`,
              snippetNeedle: selectedBodyNeedle
                ? sql<string>`coalesce(${selectedBodyNeedle}, '')`
                : sql<string>`''`,
              contentLength: sql<number>`length(${normalizedContent})`,
              beforeOpenMarker,
            })
            .from(schema.documents)
            .where(
              and(
                baseWhere,
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
      const countQuery = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.documents)
        .where(where)
        .$dynamic();
      if (indexedSearch) {
        countQuery.innerJoin(indexedSearch.join, indexedSearch.on);
      }
      let totalItems: number;
      if (docs.length) {
        totalItems = Number(docs[0].totalItems);
      } else {
        // count(*) without GROUP BY always returns one row.
        const counted: ({ count: number } | undefined)[] = await countQuery;
        totalItems = Number(counted[0]?.count ?? 0);
      }
      return { docs, previewById, totalItems };
    };
    // Words the caller's own search can return, so a correction never
    // reveals a word from a document they can't open.
    const visibleVocabulary = async () => {
      const text =
        args.searchFields === "title"
          ? sql`coalesce(${schema.documents.title}, '')`
          : sql`coalesce(${schema.documents.title}, '') || ' ' || coalesce(${schema.documents.description}, '')`;
      // Split on whitespace and ASCII punctuation here, so "roadmap," and
      // "roadmap" count as one word; searchVocabulary splits the rest.
      // `[:punct:]` would also split at combining accents in UTF-8 locales.
      const words = db
        .select({
          word: sql<string>`regexp_split_to_table(lower(${text}), ${"[\\s\\x21-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\x7e]+"})`.as(
            "word",
          ),
        })
        .from(schema.documents)
        .where(baseWhere)
        .as("visible_words");
      const rows = await db
        .select({ word: words.word })
        .from(words)
        .where(sql`${words.word} <> ''`)
        .groupBy(words.word)
        .orderBy(desc(sql`count(*)`), asc(words.word))
        .limit(TYPO_VOCABULARY_LIMIT);
      return searchVocabulary(rows.map((row) => row.word));
    };

    // The meaning lane runs beside the first word search, never before it.
    const skipReason = parsedQuery
      ? semanticSkipReason(args, parsedQuery)
      : null;
    const semanticPending =
      args.query && parsedQuery && !skipReason
        ? searchSemanticIndex(documentSearchIndex, {
            query: args.query,
            audienceIds: semanticSearcherAudienceIds({
              userEmail,
              orgIds: authorizedOrgIds,
            }),
            limit: SEMANTIC_CANDIDATES,
          })
        : null;
    // Hybrid search reads the top word matches to fuse; words alone read the
    // requested page.
    const firstWindow = semanticPending
      ? { limit: LANE_DEPTH, offset: 0 }
      : { limit: args.limit, offset: args.offset };

    let lexical = await searchPage(parsedQuery, firstWindow);
    let lexicalQuery = parsedQuery;
    let spellingCorrections: SpellingCorrection[] | undefined;
    if (
      lexical.totalItems === 0 &&
      parsedQuery &&
      !parsedQuery.empty &&
      !args.exactTitle &&
      hasCorrectableWord(parsedQuery)
    ) {
      const corrected = correctSearchQueryTypos(
        parsedQuery,
        await visibleVocabulary(),
      );
      if (corrected) {
        const correctedPage = await searchPage(corrected.query, firstWindow);
        if (correctedPage.totalItems > 0) {
          lexical = correctedPage;
          lexicalQuery = corrected.query;
          spellingCorrections = corrected.corrections;
        }
      }
    }

    let { docs, previewById, totalItems } = lexical;
    let matchedBy: Map<string, MatchedBy> | undefined;
    let semanticSearch: SemanticSearchStatus | undefined = skipReason
      ? { status: "skipped", reason: skipReason }
      : undefined;
    if (semanticPending) {
      const semantic = await semanticPending;
      semanticSearch = semanticStatus(semantic);
      // Meaning matches the caller may open, in the requested place, under
      // the same filters as word matches.
      const meaningIds: string[] = [];
      if (semantic.status === "used" && semantic.hits.length) {
        const hitIds = semantic.hits.map((hit) => hit.id);
        const visible = await db
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(and(baseWhere, inArray(schema.documents.id, hitIds)));
        const visibleIds = new Set(visible.map((row) => row.id));
        for (const id of hitIds) {
          if (visibleIds.has(id)) meaningIds.push(id);
          if (meaningIds.length >= LANE_DEPTH) break;
        }
      }
      if (!meaningIds.length) {
        // Words alone, whose first matches are already read.
        if (args.offset + args.limit > LANE_DEPTH) {
          ({ docs, previewById, totalItems } = await searchPage(lexicalQuery, {
            limit: args.limit,
            offset: args.offset,
          }));
        } else {
          docs = lexical.docs.slice(args.offset, args.offset + args.limit);
        }
        if (semantic.status === "used") {
          matchedBy = new Map(docs.map((doc) => [doc.id, "words" as const]));
        }
      } else {
        const fused = reciprocalRankFusion(
          {
            words: lexical.docs.map((doc, index) => ({
              key: doc.id,
              value: doc.id,
              score: LANE_DEPTH - index,
            })),
            meaning: meaningIds.map((id, index) => ({
              key: id,
              value: id,
              score: LANE_DEPTH - index,
            })),
          },
          { rankConstant: 60, limit: 2 * LANE_DEPTH },
        );
        const fusedIds = fused.map((candidate) => candidate.key);
        const pageIds = fusedIds.slice(args.offset, args.offset + args.limit);
        const lexicalIds = new Set(lexical.docs.map((doc) => doc.id));
        const meaningOnlyIds = pageIds.filter((id) => !lexicalIds.has(id));
        const meaningRows = meaningOnlyIds.length
          ? await searchPage(null, {
              limit: meaningOnlyIds.length,
              offset: 0,
              onlyIds: meaningOnlyIds,
            })
          : null;
        // Word matches past the fused ones, which they never repeat. A page
        // inside the fused results still reads their count.
        const tail = await searchPage(lexicalQuery, {
          limit: args.limit - pageIds.length,
          offset: Math.max(0, args.offset - fusedIds.length),
          excludeIds: fusedIds,
        });
        const rowById = new Map(
          [...lexical.docs, ...(meaningRows ? meaningRows.docs : [])].map(
            (doc) => [doc.id, doc],
          ),
        );
        docs = [
          ...pageIds.flatMap((id) => {
            const doc = rowById.get(id);
            return doc ? [doc] : [];
          }),
          ...tail.docs,
        ];
        previewById = new Map([
          ...lexical.previewById,
          ...(meaningRows ? meaningRows.previewById : []),
          ...tail.previewById,
        ]);
        totalItems = fusedIds.length + tail.totalItems;
        matchedBy = new Map([
          ...fused.map((candidate): [string, MatchedBy] => [
            candidate.key,
            candidate.laneRanks.words && candidate.laneRanks.meaning
              ? "both"
              : candidate.laneRanks.words
                ? "words"
                : "meaning",
          ]),
          ...tail.docs.map((doc): [string, MatchedBy] => [doc.id, "words"]),
        ]);
      }
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
          snippet: previewSnippet(preview),
          contentLength: Number(preview?.contentLength) || 0,
          hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
          updatedAt: doc.updatedAt,
          ...(matchedBy?.has(doc.id)
            ? { matchedBy: matchedBy.get(doc.id) }
            : {}),
        };
      }),
      pagination: documentDiscoveryPagination({
        offset: args.offset,
        limit: args.limit,
        totalItems,
        returnedItems: docs.length,
      }),
      ...(spellingCorrections ? { spellingCorrections } : {}),
      ...(semanticSearch ? { semanticSearch } : {}),
    };
  },
});

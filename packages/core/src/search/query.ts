/**
 * SQL for searching through the core index, as Drizzle fragments an app
 * composes into its own query. The app keeps its own access rule, filters,
 * paging, and output; the index supplies matching and ranking.
 *
 * Matching, for each term:
 * - titles and summaries match anywhere, including mid-word ("prio" finds
 *   "Task Priorities"), because they're short;
 * - bodies match whole words, every word as a prefix, through the GIN index;
 *   mid-word body matches are deliberately not supported. A phrase needs
 *   its words adjacent, except in a document too long or repetitive for
 *   Postgres to keep every word position, where every word being present
 *   is enough.
 *
 * Ranking reproduces the tiers the browser lane uses
 * (`TITLE_MATCH_TIER` in Content): exact title 5, title prefix 4, title word
 * prefixes 3, title substrings 2, title or summary 1, then how many query
 * groups the title and summary cover, then whether the body contains the
 * query as a phrase. Callers add their own tie-breaks.
 */
import { and, not, or, sql, type SQL } from "drizzle-orm";

import { SEARCH_RESOURCES_TABLE } from "./index-store.js";
import type { ParsedSearchQuery, SearchQueryTerm } from "./query-parser.js";
import type { SearchableResourceRegistration } from "./registry.js";
import {
  anyOfTsquery,
  isPhraseTerm,
  normalizeSearchText,
  termTsquery,
} from "./tokenize.js";

export interface IndexedSearchOptions {
  registration: SearchableResourceRegistration;
  query: Pick<ParsedSearchQuery, "groups" | "negatives">;
  /** "title" matches titles only. Defaults to title, summary, and body. */
  fields?: "all" | "title";
}

export interface IndexedSearchSql {
  /** Join target and condition: `.innerJoin(search.join, search.on)`. */
  join: SQL;
  on: SQL;
  /** Every group matches and no negative does. */
  match: SQL;
  matchTier: SQL<number>;
  titleCoverage: SQL<number>;
  summaryCoverage: SQL<number>;
  bodyPhrase: SQL<number>;
  /** The ranking terms above, best first, leaving out any that are always 0. */
  orderBy: SQL[];
}

const ALIAS = "search_index";
const titleNorm = sql.raw(`${ALIAS}.title_norm`);
const summaryNorm = sql.raw(`${ALIAS}.summary_norm`);

function escapeLike(value: string) {
  return value.replace(/([\\%_])/g, "\\$1");
}

function escapeRegex(value: string) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function contains(column: SQL, needle: string): SQL {
  return sql`${column} LIKE ${`%${escapeLike(needle)}%`} ESCAPE '\\'`;
}

function startsWith(column: SQL, needle: string): SQL {
  return sql`${column} LIKE ${`${escapeLike(needle)}%`} ESCAPE '\\'`;
}

function wordPrefix(column: SQL, needle: string): SQL {
  const pattern = escapeRegex(needle).replace(/\s+/g, "[[:space:]]+");
  return sql`${column} ~* ${`(^|[^[:alnum:]_])${pattern}`}`;
}

// A bare constant in ORDER BY is read as a column position, so ranking terms
// that can only be zero are left out of the order rather than written as 0.
const ZERO = sql<number>`0`;

function sumOf(conditions: SQL[]): SQL<number> | null {
  if (!conditions.length) return null;
  return sql<number>`(${sql.join(
    conditions.map(
      (condition) => sql`case when ${condition} then 1 else 0 end`,
    ),
    sql` + `,
  )})`;
}

export function indexedSearchSql(
  options: IndexedSearchOptions,
): IndexedSearchSql {
  const { registration, query } = options;
  const titleOnlyField = options.fields === "title";
  const needle = (term: SearchQueryTerm) => normalizeSearchText(term.text);
  const bodyTerms = (terms: readonly SearchQueryTerm[]) =>
    titleOnlyField ? [] : terms.filter((term) => !term.titleOnly);

  const bodyMatch = (terms: readonly SearchQueryTerm[]): SQL | undefined => {
    const tsquery = anyOfTsquery(
      terms.map((term) => termTsquery(term.text, { prefix: true })),
    );
    if (!tsquery) return undefined;
    // A document whose vector lost positions can't be phrase-matched
    // exactly, so a phrase matches it when every word is present.
    const anyOrder = anyOfTsquery(
      terms
        .filter((term) => isPhraseTerm(term.text))
        .map((term) =>
          termTsquery(term.text, { prefix: true, anyOrder: true }),
        ),
    );
    const vectorMatch = anyOrder
      ? sql`(doc_vector @@ ${tsquery}::tsquery OR (NOT positions_complete AND doc_vector @@ ${anyOrder}::tsquery))`
      : sql`doc_vector @@ ${tsquery}::tsquery`;
    return sql`${sql.raw(`${ALIAS}.resource_id`)} IN (SELECT resource_id FROM ${sql.raw(SEARCH_RESOURCES_TABLE)} WHERE app = ${registration.app} AND resource_type = ${registration.type} AND ${vectorMatch})`;
  };

  const titleAny = (terms: readonly SearchQueryTerm[]) =>
    or(...terms.map((term) => contains(titleNorm, needle(term))))!;
  const summaryAny = (terms: readonly SearchQueryTerm[]) => {
    const eligible = bodyTerms(terms);
    return eligible.length
      ? or(...eligible.map((term) => contains(summaryNorm, needle(term))))!
      : undefined;
  };
  const anyField = (terms: readonly SearchQueryTerm[]) =>
    or(titleAny(terms), summaryAny(terms), bodyMatch(bodyTerms(terms)))!;

  const groups = query.groups.filter((group) => group.terms.length > 0);
  const match =
    groups.length || query.negatives.length
      ? and(
          ...groups.map((group) => anyField(group.terms)),
          ...query.negatives.map((negative) => not(anyField([negative]))),
        )!
      : sql`false`;

  const simpleQueries =
    groups.length > 0 && groups.every((group) => group.terms.length === 1)
      ? [groups.map((group) => group.terms[0]!.text.trim()).join(" ")]
      : groups.length === 1
        ? groups[0]!.terms.map((term) => term.text.trim())
        : [];
  const normalizedSimpleQueries = simpleQueries
    .map(normalizeSearchText)
    .filter(Boolean);
  const guardTitle = groups.every((group) =>
    group.terms.every((term) => !/\s/.test(term.text)),
  );
  const allTitleSubstrings = groups.length
    ? and(...groups.map((group) => titleAny(group.terms)))!
    : sql`false`;
  const allTitleWordPrefixes = groups.length
    ? and(
        ...groups.map(
          (group) =>
            or(
              ...group.terms.map((term) => wordPrefix(titleNorm, needle(term))),
            )!,
        ),
      )!
    : sql`false`;
  const allTitleOrSummary = groups.length
    ? and(
        ...groups.map(
          (group) => or(titleAny(group.terms), summaryAny(group.terms))!,
        ),
      )!
    : sql`false`;
  const simpleTier = (compare: (query: string) => SQL) =>
    normalizedSimpleQueries.length
      ? and(
          guardTitle ? allTitleSubstrings : sql`true`,
          or(...normalizedSimpleQueries.map(compare))!,
        )!
      : sql`false`;
  const matchTier = sql<number>`case
    when ${simpleTier((simple) => sql`${titleNorm} = ${simple}`)} then 5
    when ${simpleTier((simple) => startsWith(titleNorm, simple))} then 4
    when ${allTitleSubstrings} and ${allTitleWordPrefixes} then 3
    when ${allTitleSubstrings} then 2
    when ${allTitleOrSummary} then 1
    else 0
  end`;

  const titleCoverage = sumOf(groups.map((group) => titleAny(group.terms)));
  const summaryCoverage = sumOf(
    groups.flatMap((group) => {
      const condition = summaryAny(group.terms);
      return condition ? [condition] : [];
    }),
  );

  // The whole query as a phrase in the body, when it is two or more plain
  // words, one per group.
  const phraseTerms =
    !titleOnlyField &&
    groups.length >= 2 &&
    groups.every(
      (group) => group.terms.length === 1 && !group.terms[0]!.titleOnly,
    )
      ? groups.map((group) => group.terms[0]!.text.trim()).join(" ")
      : null;
  const phraseQuery = phraseTerms
    ? termTsquery(phraseTerms, { prefix: true, weights: "C" })
    : null;
  const bodyPhrase = phraseQuery
    ? sql<number>`case when ${sql.raw(`${ALIAS}.doc_vector`)} @@ ${phraseQuery}::tsquery then 1 else 0 end`
    : null;

  return {
    join: sql`${sql.raw(SEARCH_RESOURCES_TABLE)} AS ${sql.raw(ALIAS)}`,
    on: sql`${sql.raw(`${ALIAS}.app`)} = ${registration.app} AND ${sql.raw(`${ALIAS}.resource_type`)} = ${registration.type} AND ${sql.raw(`${ALIAS}.resource_id`)} = ${registration.idColumn}::text`,
    match,
    matchTier,
    titleCoverage: titleCoverage ?? ZERO,
    summaryCoverage: summaryCoverage ?? ZERO,
    bodyPhrase: bodyPhrase ?? ZERO,
    orderBy: [matchTier, titleCoverage, summaryCoverage, bodyPhrase]
      .filter((term): term is SQL<number> => term !== null)
      .map((term) => sql`${term} desc`),
  };
}

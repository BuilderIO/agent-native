import { and, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import type {
  ParsedSearchQuery,
  SearchQueryGroup,
  SearchQueryTerm,
} from "../shared/search-query.js";

function escapeLike(value: string) {
  return value.replace(/([\\%_])/g, "\\$1");
}

function substringMatch(column: SQLWrapper, term: SearchQueryTerm): SQL {
  return sql`${column} ILIKE ${`%${escapeLike(term.text)}%`} ESCAPE '\\'`;
}

function escapeRegex(value: string) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function regexTerm(value: string) {
  return escapeRegex(value.trim()).replace(/\s+/g, "[[:space:]]+");
}

export function searchQueryProximityPattern(parsed: ParsedSearchQuery) {
  if (
    parsed.groups.length < 2 ||
    parsed.groups.some(
      (group) => group.terms.length !== 1 || group.terms[0]!.titleOnly,
    )
  ) {
    return null;
  }
  return parsed.groups
    .map((group) => regexTerm(group.terms[0]!.text))
    .join("(.|\\n){0,240}");
}

function wordPrefixMatch(column: SQLWrapper, term: SearchQueryTerm): SQL {
  const pattern = regexTerm(term.text);
  return sql`${column} ~* ${`(^|[^[:alnum:]_])${pattern}`}`;
}

function groupSubstringMatch(column: SQLWrapper, group: SearchQueryGroup): SQL {
  return or(...group.terms.map((term) => substringMatch(column, term)))!;
}

function nonTitleGroupSubstringMatch(
  column: SQLWrapper,
  group: SearchQueryGroup,
): SQL {
  const terms = group.terms.filter((term) => !term.titleOnly);
  return terms.length
    ? or(...terms.map((term) => substringMatch(column, term)))!
    : sql`false`;
}

function groupWordPrefixMatch(
  column: SQLWrapper,
  group: SearchQueryGroup,
): SQL {
  return or(...group.terms.map((term) => wordPrefixMatch(column, term)))!;
}

function countMatchingGroups(
  column: SQLWrapper,
  groups: SearchQueryGroup[],
  nonTitleOnly = false,
): SQL<number> {
  if (!groups.length) return sql<number>`0`;
  return sql<number>`(${sql.join(
    groups.map(
      (group) =>
        sql`case when ${nonTitleOnly ? nonTitleGroupSubstringMatch(column, group) : groupSubstringMatch(column, group)} then 1 else 0 end`,
    ),
    sql` + `,
  )})`;
}

export interface DocumentSearchRankingColumns {
  title: SQLWrapper;
  description: SQLWrapper;
  content: SQLWrapper;
}

export interface DocumentSearchRankingOptions {
  includeNonTitleFields?: boolean;
}

function bodyProximityScore(
  parsed: ParsedSearchQuery,
  content: SQLWrapper,
): SQL<number> {
  if (
    parsed.groups.length < 2 ||
    parsed.groups.some(
      (group) => group.terms.length !== 1 || group.terms[0]!.titleOnly,
    )
  ) {
    return sql<number>`case when true then 0 else 0 end`;
  }
  const phrase = parsed.groups
    .map((group) => group.terms[0]!.text.trim())
    .join(" ");
  return sql<number>`case when ${content} ILIKE ${`%${escapeLike(phrase)}%`} ESCAPE '\\' then 1 else 0 end`;
}

export function documentSearchRanking(
  parsed: ParsedSearchQuery,
  columns: DocumentSearchRankingColumns,
  options: DocumentSearchRankingOptions = {},
) {
  const groups = parsed.groups;
  const includeNonTitleFields = options.includeNonTitleFields ?? true;
  const normalizedTitle = sql<string>`regexp_replace(lower(trim(coalesce(${columns.title}, ''))), '\\s+', ' ', 'g')`;
  const simpleQueries =
    groups.length > 0 && groups.every((group) => group.terms.length === 1)
      ? [groups.map((group) => group.terms[0]!.text.trim()).join(" ")]
      : groups.length === 1
        ? groups[0]!.terms.map((term) => term.text.trim())
        : [];
  const normalizedSimpleQueries = simpleQueries.map((query) =>
    query.toLocaleLowerCase().replace(/\s+/g, " "),
  );
  const guardNormalizedTitle = groups.every((group) =>
    group.terms.every((term) => !/\s/.test(term.text)),
  );
  const allTitleSubstrings = groups.length
    ? and(...groups.map((group) => groupSubstringMatch(columns.title, group)))!
    : sql`false`;
  const allTitleWordPrefixes = groups.length
    ? and(...groups.map((group) => groupWordPrefixMatch(columns.title, group)))!
    : sql`false`;
  const allTitleOrDescription = groups.length
    ? and(
        ...groups.map((group) =>
          includeNonTitleFields
            ? or(
                groupSubstringMatch(columns.title, group),
                nonTitleGroupSubstringMatch(columns.description, group),
              )!
            : groupSubstringMatch(columns.title, group),
        ),
      )!
    : sql`false`;
  const matchTier = sql<number>`case
    when ${
      normalizedSimpleQueries.length
        ? and(
            guardNormalizedTitle ? allTitleSubstrings : sql`true`,
            or(
              ...normalizedSimpleQueries.map(
                (query) => sql`${normalizedTitle} = ${query}`,
              ),
            )!,
          )!
        : sql`false`
    } then 5
    when ${
      normalizedSimpleQueries.length
        ? and(
            guardNormalizedTitle ? allTitleSubstrings : sql`true`,
            or(
              ...normalizedSimpleQueries.map(
                (query) =>
                  sql`${normalizedTitle} like ${`${escapeLike(query)}%`} escape '\\'`,
              ),
            )!,
          )!
        : sql`false`
    } then 4
    when ${allTitleSubstrings} and ${allTitleWordPrefixes} then 3
    when ${allTitleSubstrings} then 2
    when ${allTitleOrDescription} then 1
    else 0
  end`;
  return {
    matchTier,
    titleCoverage: countMatchingGroups(columns.title, groups),
    descriptionCoverage: includeNonTitleFields
      ? countMatchingGroups(columns.description, groups, true)
      : sql<number>`0::integer`,
    bodyProximity: includeNonTitleFields
      ? bodyProximityScore(parsed, columns.content)
      : sql<number>`0::integer`,
  };
}

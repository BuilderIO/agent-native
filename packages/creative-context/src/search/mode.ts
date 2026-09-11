import {
  matchesSearchMode,
  type SearchMatchMode,
} from "@agent-native/core/search-utils";

export function shouldUsePostgresFts(matchMode: SearchMatchMode | undefined) {
  return matchMode !== "regex";
}

export function matchesCreativeSearchMode(
  value: string,
  query: string,
  matchMode: SearchMatchMode,
): boolean {
  if (matchMode !== "phrase") {
    return matchesSearchMode(value, query, matchMode);
  }
  const normalizedValue = value.toLocaleLowerCase().replace(/\s+/g, " ");
  const normalizedQuery = query.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  return Boolean(normalizedQuery) && normalizedValue.includes(normalizedQuery);
}

// The query language lives in core so the browser lane, the server index,
// and agents parse queries the same way.
export {
  parseSearchQuery,
  searchQueryNeedles,
  type ParsedSearchQuery,
  type SearchQueryGroup,
  type SearchQueryTerm,
} from "@agent-native/core/search-query";

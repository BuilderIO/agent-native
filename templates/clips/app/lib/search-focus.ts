export const SEARCH_FOCUS_PARAM = "focus";
export const SEARCH_FOCUS_VALUE = "search";
export const SEARCH_FOCUS_PATH = `/library?${SEARCH_FOCUS_PARAM}=${SEARCH_FOCUS_VALUE}`;

export function hasSearchFocusRequest(params: URLSearchParams): boolean {
  return params.get(SEARCH_FOCUS_PARAM) === SEARCH_FOCUS_VALUE;
}

export function clearSearchFocusRequest(
  params: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(SEARCH_FOCUS_PARAM);
  return next;
}

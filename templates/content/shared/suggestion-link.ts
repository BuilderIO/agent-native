export function contentSuggestionPath(
  documentId: string,
  suggestionId: string,
): string {
  return `/page/${encodeURIComponent(documentId)}?suggestion=${encodeURIComponent(suggestionId)}`;
}

/**
 * The compact review card for the suggestions one call created, which MCP
 * Apps hosts embed inline. Opened in a browser tab, it forwards to the page.
 */
export function contentSuggestionReviewPath(
  documentId: string,
  suggestionIds: readonly string[],
): string {
  return `/suggestions/${encodeURIComponent(documentId)}?ids=${suggestionIds.map(encodeURIComponent).join(",")}`;
}

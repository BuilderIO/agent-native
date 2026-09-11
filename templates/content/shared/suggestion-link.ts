export function contentSuggestionPath(
  documentId: string,
  suggestionId: string,
): string {
  return `/page/${encodeURIComponent(documentId)}?suggestion=${encodeURIComponent(suggestionId)}`;
}

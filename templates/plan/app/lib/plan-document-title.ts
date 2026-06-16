export function planDocumentTitle(
  planTitle: string | null | undefined,
  fallbackTitle: string,
): string {
  return planTitle?.trim() || fallbackTitle;
}

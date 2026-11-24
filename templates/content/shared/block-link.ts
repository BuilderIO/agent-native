export function contentBlockLinkPath(
  documentId: string,
  blockId: string,
): string {
  return `/page/${encodeURIComponent(documentId)}?block=${encodeURIComponent(blockId)}`;
}

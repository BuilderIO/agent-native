export const SCREEN_DOCUMENT_PREVIEW_CHARS = 1_200;

export function documentContentPreviewBody(content: string): string {
  return content.trim().slice(0, SCREEN_DOCUMENT_PREVIEW_CHARS).trimEnd();
}

export function documentContentPreview(content: string) {
  const normalized = content.trim();
  if (normalized.length <= SCREEN_DOCUMENT_PREVIEW_CHARS) {
    return {
      contentPreview: normalized,
      contentLength: content.length,
      contentTruncated: false,
    };
  }

  return {
    contentPreview: `${documentContentPreviewBody(content)}... [document body truncated; call get-document for the full content]`,
    contentLength: content.length,
    contentTruncated: true,
  };
}

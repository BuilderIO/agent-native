export const CONTENT_LINK_ID_MAX_LENGTH = 256;
export const CONTENT_LINK_BATCH_MAX = 100;

/** Whether a page-link id can name a document; anything else cannot resolve. */
export function isContentLinkId(value: string) {
  return (
    value.length > 0 &&
    value.length <= CONTENT_LINK_ID_MAX_LENGTH &&
    value.trim() === value
  );
}

/** A Notion page id or page URL as the page's 32 lowercase hex digits. */
export function normalizeNotionPageId(input: string | null | undefined) {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F-]{36}$/.test(trimmed)) {
    return trimmed.replace(/-/g, "").toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    const slug = url.pathname.split("/").filter(Boolean).pop() || "";
    const match =
      slug.match(/([0-9a-fA-F]{32})$/) || slug.match(/([0-9a-fA-F-]{36})$/);
    return match?.[1]?.replace(/-/g, "").toLowerCase() ?? null;
  } catch {
    // coercion-ok: text that isn't a URL names no Notion page.
    return null;
  }
}

/** A 32-digit Notion page id in the dashed form Notion also stores. */
export function dashedNotionPageId(key: string) {
  return `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
}

/**
 * The page a page-link block points to, from its attributes: a Content
 * document id, or the Notion page id of an imported page.
 */
export function pageLinkBlockId(attrs: Record<string, string>) {
  return (
    attrs["data-agent-native-document-id"] ||
    attrs.id ||
    (normalizeNotionPageId(attrs.url) ??
      normalizeNotionPageId(attrs.href) ??
      normalizeNotionPageId(attrs.pageId) ??
      normalizeNotionPageId(attrs.page_id))
  );
}

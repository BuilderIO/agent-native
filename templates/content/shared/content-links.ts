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

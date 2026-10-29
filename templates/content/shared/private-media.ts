/**
 * Links to private images, as page bodies store them. The stored form never
 * carries the app's base path, so a page reads the same wherever Content is
 * mounted; the editor adds the base path when it renders the image.
 */
export const PRIVATE_MEDIA_PATH_PREFIX = "/api/private-media/";

const PRIVATE_MEDIA_LINK =
  /\/api\/private-media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/gu;

export function privateMediaPath(mediaId: string): string {
  return `${PRIVATE_MEDIA_PATH_PREFIX}${mediaId}`;
}

/** The private image IDs a body links to. */
export function privateMediaIdsInContent(content: string): Set<string> {
  const found = new Set<string>();
  if (!content.includes(PRIVATE_MEDIA_PATH_PREFIX)) return found;
  for (const match of content.matchAll(PRIVATE_MEDIA_LINK)) {
    found.add(match[1]!);
  }
  return found;
}

/** The image ID when `src` is a stored private image link, else null. */
export function privateMediaIdFromSrc(src: string): string | null {
  const match = /^\/api\/private-media\/([0-9a-f-]{36})$/u.exec(src);
  return match && privateMediaIdsInContent(src).has(match[1]!)
    ? match[1]!
    : null;
}

/**
 * Postgres rejects an index entry over about 2.7 KB, and one rejected row fails
 * its whole insert, so caller text stored in an indexed column is cut first.
 * Lengths count UTF-16 code units, each at most three UTF-8 bytes, and are sized
 * so the widest index, (org_id, path, event_name), stays under that limit.
 */
export const MAX_EVENT_NAME_LENGTH = 200;
/** App and template names. */
export const MAX_APP_LENGTH = 100;
export const MAX_PATH_LENGTH = 500;
export const MAX_USER_KEY_LENGTH = 256;

/**
 * Never ends on half of a surrogate pair, which Postgres would store as a
 * replacement character.
 */
export function boundedText(
  value: string | null | undefined,
  maxLength: number,
): string {
  const text = value?.trim().slice(0, maxLength) ?? "";
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
}

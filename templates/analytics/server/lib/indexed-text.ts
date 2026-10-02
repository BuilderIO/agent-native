import { createHash } from "node:crypto";

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
 * Session and recording ids are rejected or skipped past this length, never
 * cut, because a cut id could merge two sessions.
 */
export const MAX_SESSION_ID_LENGTH = 256;
/**
 * Row ids are primary keys, and percent-encoding can triple already bounded
 * text, so a longer id is replaced by a hash of its parts.
 */
const MAX_ROW_ID_LENGTH = 512;

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

/**
 * For a value that identifies something, such as a user. A plain cut would
 * merge every value sharing the kept prefix, so a value past the limit keeps a
 * shorter prefix plus a hash of the whole value.
 */
export function boundedIdentity(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return `${boundedText(text, maxLength - digest.length - 1)}~${digest}`;
}

export function indexedRowId(prefix: string, parts: readonly string[]): string {
  const id = `${prefix}_${parts.map((part) => encodeURIComponent(part)).join("|")}`;
  if (id.length <= MAX_ROW_ID_LENGTH) return id;
  return `${prefix}_h_${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

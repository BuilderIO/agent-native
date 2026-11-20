const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * One row id segment from app data (a record id, an email, a provider name).
 * A value that is already a valid segment is returned as is; any other value
 * is slugged and suffixed with a hash of the original, so two values that
 * slug alike (`a.b@x.com`, `a-b@x.com`) still get different ids.
 */
export function rowIdSegment(value: string): string {
  if (SEGMENT.test(value)) return value;
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-${hash(value)}` : `x-${hash(value)}`;
}

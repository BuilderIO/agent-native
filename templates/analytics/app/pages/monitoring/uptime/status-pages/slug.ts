/**
 * Client-side slug helpers for status pages. Mirror the server `normalizeSlug`
 * (server/lib/status-pages.ts) so the in-app editor derives + validates the
 * public `/status/<slug>` value the same way the server will store it. Pure so
 * they are trivially unit-tested.
 */
export const MAX_SLUG_LENGTH = 64;

/** Lowercase, `[a-z0-9-]`, collapsed/trimmed dashes, capped at 64 chars. */
export function slugify(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, "");
}

/** A slug is valid when it is non-empty, `[a-z0-9-]`, no leading/trailing/double dashes. */
export function isValidSlug(slug: string): boolean {
  if (!slug || slug.length > MAX_SLUG_LENGTH) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

const STRUCTURED_TITLE_START = /^[\[{]/;

/**
 * Browser titles must be human-readable strings. React Router stringifies a
 * structured `title` value, which otherwise leaks the whole payload into the
 * browser tab.
 */
export function isHumanReadableDocumentTitle(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const title = value.trim();
  if (!title) return false;
  if (!STRUCTURED_TITLE_START.test(title)) return true;

  try {
    const parsed = JSON.parse(title);
    return parsed === null || typeof parsed !== "object";
  } catch {
    return true;
  }
}

export function normalizeDocumentTitle(
  value: unknown,
  fallbackTitle: string,
): string {
  if (isHumanReadableDocumentTitle(value)) return value.trim();
  if (isHumanReadableDocumentTitle(fallbackTitle)) return fallbackTitle.trim();
  return "Agent Native";
}

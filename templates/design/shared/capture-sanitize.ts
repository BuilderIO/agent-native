/**
 * Shared sanitization helpers for design state capture payloads.
 *
 * Used by both create-design-state and capture-design-state to enforce a
 * consistent stored-XSS guard and size cap before persisting arbitrary
 * caller-supplied markup / DOM snapshots into `design_state` rows.
 */

/**
 * Maximum serialised size of a captured/replayed `captureData` or
 * `fixtureData` payload. Caps single-row size to protect the DB and the
 * shareable content each row feeds.
 */
export const CAPTURE_DATA_MAX_BYTES = 256 * 1024; // 256 KB

/**
 * Strip stored-XSS vectors out of an HTML/markup string before it is persisted
 * and later replayed into shareable design content. Mirrors the framework's
 * text-edit HTML sanitiser: removes script/style/iframe/object/embed/link/meta/
 * base tags, inline `on*` handlers, and `javascript:` / `vbscript:` / `data:`
 * URLs in `href` / `src` / `xlink:href`.
 */
export function sanitizeMarkup(html: string): string {
  return html
    .replace(
      /<\s*(script|style|iframe|object|embed|link|meta|base)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
      "",
    )
    .replace(
      /<\s*(script|style|iframe|object|embed|link|meta|base)\b[^>]*\/?\s*>/gi,
      "",
    )
    .replace(/\s+on[A-Za-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, "")
    .replace(
      /\s+(href|src|xlink:href)\s*=\s*(?:(["'])\s*(?:javascript|vbscript|data):[\s\S]*?\2|(?:javascript|vbscript|data):[^\s>]*)/gi,
      "",
    );
}

/**
 * A string "looks like markup" — and is therefore worth sanitising — when it
 * contains an angle-bracket tag opener or an Alpine `x-`/`@`/`:` binding that
 * could carry script. Plain data strings (route names, ids) are left untouched.
 */
export function looksLikeMarkup(value: string): boolean {
  return /<[a-zA-Z!/]/.test(value) || value.includes("</");
}

/**
 * Recursively sanitise every string value inside a captured/replayed
 * `captureData` or `fixtureData` object (e.g. `domHtml`, `domSnapshot`,
 * `x-data` markup) so no untrusted DOM is persisted raw. Non-string leaves
 * pass through unchanged.
 */
export function sanitizeCaptureData(value: unknown): unknown {
  if (typeof value === "string") {
    return looksLikeMarkup(value) ? sanitizeMarkup(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeCaptureData(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeCaptureData(v);
    }
    return out;
  }
  return value;
}

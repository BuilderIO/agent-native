/**
 * Client-safe meta-tag formatting helpers. Keep this module free of server
 * imports — route `meta` functions run in the browser, so anything imported
 * here ships in the client bundle.
 */

/**
 * Build a meta description from a plan brief, truncated to ~160 chars.
 */
export function buildPlanMetaDescription(brief: string): string {
  const trimmed = brief.trim();
  if (trimmed.length <= 160) return trimmed;
  // Truncate at the last space before or at the 157-char mark so we can
  // append an ellipsis without exceeding 160 characters total.
  const cut = trimmed.lastIndexOf(" ", 157);
  return `${trimmed.slice(0, cut > 0 ? cut : 157)}…`;
}

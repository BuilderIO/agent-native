/**
 * Normalize an allowlist entry or an incoming `Origin` header for exact-match
 * comparison. This does not widen what is admitted — it is still an exact
 * scheme+host+port match — it only tolerates formatting slop that carries no
 * security meaning:
 *  - scheme/host casing (RFC 6454 origins are case-insensitive; an operator
 *    pasting a domain from a UI that preserves entered case can end up with
 *    e.g. "HTTPS://App.Example.com")
 *  - a trailing slash (browsers never send one in `Origin`, but it's an easy
 *    copy/paste mistake when configuring the allowlist)
 *  - a bare domain with no scheme (`CORS_ALLOWED_ORIGINS` is operationally a
 *    "domain allowlist" — operators reasonably enter "app.example.com"
 *    instead of "https://app.example.com", which then never matches a real
 *    Origin header and silently locks out that legitimate origin)
 */
export function normalizeCorsOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  return (hasScheme ? trimmed : `https://${trimmed}`).toLowerCase();
}

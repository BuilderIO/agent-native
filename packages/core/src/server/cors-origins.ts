const LOCALHOST_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?$/;

const NATIVE_APP_ORIGIN_RE =
  /^(tauri:\/\/(localhost|tauri\.localhost)|https?:\/\/tauri\.localhost(:\d+)?)$/;

export interface CorsOriginOptions {
  allowedOrigins?: string[];
  allowAnyOriginWhenNoAllowlist?: boolean;
  allowLocalhostWhenNoAllowlist?: boolean;
}

export function readCorsAllowedOrigins(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isTrustedNativeAppOrigin(origin: string): boolean {
  return NATIVE_APP_ORIGIN_RE.test(origin);
}

export function isLocalhostOrigin(origin: string): boolean {
  return LOCALHOST_ORIGIN_RE.test(origin);
}

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
function normalizeCorsOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  return (hasScheme ? trimmed : `https://${trimmed}`).toLowerCase();
}

export function getAllowedCorsOrigin(
  origin: string | undefined,
  options: CorsOriginOptions = {},
): string | null {
  if (!origin) return null;

  if (isTrustedNativeAppOrigin(origin)) return origin;

  const allowedOrigins = options.allowedOrigins ?? readCorsAllowedOrigins();
  if (allowedOrigins.length > 0) {
    const normalizedOrigin = normalizeCorsOrigin(origin);
    return allowedOrigins.some(
      (allowed) => normalizeCorsOrigin(allowed) === normalizedOrigin,
    )
      ? origin
      : null;
  }

  if (options.allowAnyOriginWhenNoAllowlist) return origin;

  const allowLocalhost =
    options.allowLocalhostWhenNoAllowlist ??
    process.env.NODE_ENV === "development";
  if (allowLocalhost) {
    return isLocalhostOrigin(origin) ? origin : null;
  }

  return null;
}

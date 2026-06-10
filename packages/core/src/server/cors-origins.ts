const LOCALHOST_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?$/;

const NATIVE_APP_ORIGIN_RE =
  /^(tauri:\/\/(localhost|tauri\.localhost)|https?:\/\/tauri\.localhost(:\d+)?)$/;

export interface CorsOriginOptions {
  allowedOrigins?: string[];
  allowAnyOriginWhenNoAllowlist?: boolean;
  // When true, a localhost origin is echoed back even without an explicit
  // allowlist. Callers must NOT pass true in production — the default resolves
  // to NODE_ENV === "development" so the fallback is dev-only.
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

export function getAllowedCorsOrigin(
  origin: string | undefined,
  options: CorsOriginOptions = {},
): string | null {
  if (!origin) return null;

  // Tauri's production WebView uses a private app origin. It is not a
  // deploy-configured website origin, so keep it reachable even when an app
  // also has CORS_ALLOWED_ORIGINS for browser embeds or previews.
  if (isTrustedNativeAppOrigin(origin)) return origin;

  const allowedOrigins = options.allowedOrigins ?? readCorsAllowedOrigins();
  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(origin) ? origin : null;
  }

  if (options.allowAnyOriginWhenNoAllowlist) return origin;

  // Default: allow localhost only in development. Production with no allowlist
  // must deny localhost callers — an arbitrary process on the user's machine
  // must not make readable credentialed cross-origin calls to a production API.
  const allowLocalhost =
    options.allowLocalhostWhenNoAllowlist ??
    process.env.NODE_ENV === "development";
  if (allowLocalhost) {
    return isLocalhostOrigin(origin) ? origin : null;
  }

  return null;
}

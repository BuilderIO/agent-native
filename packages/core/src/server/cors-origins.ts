import { normalizeCorsOrigin } from "../shared/cors-origin.js";

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

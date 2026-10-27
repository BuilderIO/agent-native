export const ANALYTICS_SESSION_ID_COOKIE_NAME = "an_sid";
export const ANALYTICS_SESSION_ID_COOKIE_MAX_AGE_SECONDS = 30 * 60;
export const ANALYTICS_SESSION_ID_MAX_LENGTH = 127;

const ANALYTICS_SESSION_ID_PATTERN = /^[!-~]+$/;

export function normalizeAnalyticsSessionId(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > ANALYTICS_SESSION_ID_MAX_LENGTH ||
    !ANALYTICS_SESSION_ID_PATTERN.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

export function serializeAnalyticsSessionIdCookie(
  value: unknown,
): string | undefined {
  const sessionId = normalizeAnalyticsSessionId(value);
  if (!sessionId) return undefined;
  return `${ANALYTICS_SESSION_ID_COOKIE_NAME}=${encodeURIComponent(sessionId)}; path=/; max-age=${ANALYTICS_SESSION_ID_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

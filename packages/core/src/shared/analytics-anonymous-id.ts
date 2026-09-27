export const ANALYTICS_ANONYMOUS_ID_COOKIE_NAME = "an_aid";
export const ANALYTICS_ANONYMOUS_ID_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const ANALYTICS_ANONYMOUS_ID_MAX_LENGTH = 128;
const ANALYTICS_ANONYMOUS_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function normalizeAnalyticsAnonymousId(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > ANALYTICS_ANONYMOUS_ID_MAX_LENGTH ||
    !ANALYTICS_ANONYMOUS_ID_PATTERN.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

export function serializeAnalyticsAnonymousIdCookie(
  value: unknown,
): string | undefined {
  const anonymousId = normalizeAnalyticsAnonymousId(value);
  if (!anonymousId) return undefined;
  return `${ANALYTICS_ANONYMOUS_ID_COOKIE_NAME}=${encodeURIComponent(anonymousId)}; path=/; max-age=${ANALYTICS_ANONYMOUS_ID_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

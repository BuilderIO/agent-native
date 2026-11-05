/**
 * Thrown by a calendar provider when the provider rejected the credential
 * (401/403), so the host has to reconnect rather than retry.
 */
export class CalendarCredentialInvalidError extends Error {
  readonly calendarCredentialInvalid = true;

  constructor(message: string) {
    super(message);
    this.name = "CalendarCredentialInvalidError";
  }
}

/**
 * Thrown by a calendar provider when it throttled the request (rate or quota
 * limit). The credential is still good; the lookup can be retried.
 */
export class CalendarLookupRateLimitedError extends Error {
  readonly calendarLookupRateLimited = true;
  readonly retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "CalendarLookupRateLimitedError";
    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
}

export function isCalendarLookupRateLimitedError(
  error: unknown,
): error is CalendarLookupRateLimitedError {
  return (
    error instanceof CalendarLookupRateLimitedError ||
    (!!error &&
      typeof error === "object" &&
      (error as { calendarLookupRateLimited?: unknown })
        .calendarLookupRateLimited === true)
  );
}

/** Seconds from a `Retry-After` header (delta-seconds or HTTP date). */
export function parseRetryAfterSeconds(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

export function isCalendarCredentialInvalidError(
  error: unknown,
): error is CalendarCredentialInvalidError {
  return (
    error instanceof CalendarCredentialInvalidError ||
    (!!error &&
      typeof error === "object" &&
      (error as { calendarCredentialInvalid?: unknown })
        .calendarCredentialInvalid === true)
  );
}

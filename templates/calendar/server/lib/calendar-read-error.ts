export function calendarReadFailure(
  errors: Array<{ error: string; code?: string }>,
  details?: Record<string, unknown>,
) {
  const rateLimited = errors.some((error) => error.code === "RATE_LIMITED");
  const authRequired = errors.some(
    (error) =>
      error.code === "AUTH_REQUIRED" ||
      /invalid_grant|refresh token revoked|no refresh token available|no usable oauth tokens/i.test(
        error.error,
      ),
  );
  return Object.assign(
    new Error(
      rateLimited
        ? "Google Calendar is rate limited."
        : authRequired
          ? "Google Calendar authorization is required."
          : "Google Calendar events could not be loaded.",
    ),
    {
      expected: true,
      ...(details || (rateLimited && authRequired)
        ? {
            details: {
              ...details,
              ...(rateLimited && authRequired ? { authRequired: true } : {}),
            },
          }
        : {}),
      errorCode: rateLimited
        ? "calendar_rate_limited"
        : authRequired
          ? "calendar_auth_required"
          : "calendar_read_failed",
      statusCode: rateLimited ? 429 : authRequired ? 409 : 503,
    },
  );
}

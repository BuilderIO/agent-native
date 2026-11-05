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

export type LocalhostWriteConsentRequestOutcome =
  | "opened"
  | "missing-connection"
  | "not-editable";

// Carries only the server request ID through sign-in. It selects which
// pending request to reopen; the grant still checks the signed-in account.
export const LOCALHOST_CONSENT_RETURN_PARAM = "localhostConsent";

export function localhostConsentReturnPath(
  pathname: string,
  requestId: string,
): string {
  const search = new URLSearchParams({
    [LOCALHOST_CONSENT_RETURN_PARAM]: requestId,
  });
  return `${pathname}?${search}`;
}

export function isLocalhostWriteConsentError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "LocalWriteConsentRequiredError" ||
      error.name === "WriteConsentRequiredError" ||
      /write-consent grant|grant expired/i.test(error.message))
  );
}

export function localhostConsentRequestDisposition({
  requestKey,
  lastHandledKey,
  failedClearKey,
}: {
  requestKey: string;
  lastHandledKey: string | null;
  failedClearKey: string | null;
}): "show" | "retry-clear" | "ignore" {
  if (lastHandledKey !== requestKey) return "show";
  return failedClearKey === requestKey ? "retry-clear" : "ignore";
}

export function localhostConsentRequestRefetchInterval({
  requestKey,
  failedClearKey,
  queryFailed,
}: {
  requestKey: string | null;
  failedClearKey: string | null;
  queryFailed: boolean;
}): number | false {
  if (requestKey && failedClearKey === requestKey) return 1_000;
  if (!requestKey || queryFailed) return 10_000;
  return false;
}

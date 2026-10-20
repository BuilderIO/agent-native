export type LocalhostWriteConsentRequestOutcome =
  | "opened"
  | "missing-connection"
  | "not-editable";

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
}): "show-and-clear" | "retry-clear" | "ignore" {
  if (lastHandledKey !== requestKey) return "show-and-clear";
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

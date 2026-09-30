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

const GMAIL_SCOPE_PREFIX = "https://www.googleapis.com/auth/gmail.";

export function hasGmailScope(
  tokens: Record<string, unknown> | null | undefined,
): boolean {
  const scope = tokens?.scope;
  if (typeof scope !== "string" || !scope.trim()) return true;
  return scope
    .split(/[\s,]+/)
    .some((value) => value.startsWith(GMAIL_SCOPE_PREFIX));
}

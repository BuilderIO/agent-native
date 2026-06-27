const AGENT_NATIVE_ANONYMOUS_EMAIL_RE = /^anon-[^@]+@agent-native\.com$/i;

export function isAgentNativeAnonymousEmail(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return AGENT_NATIVE_ANONYMOUS_EMAIL_RE.test(value.trim());
}

export function cleanSubmitterEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 320 || !trimmed.includes("@")) return null;
  if (isAgentNativeAnonymousEmail(trimmed)) return null;
  return trimmed;
}

export function publicSubmitterEmail(
  value: string | null | undefined,
): string | null {
  return cleanSubmitterEmail(value);
}

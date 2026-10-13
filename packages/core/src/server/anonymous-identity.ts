export function isAnonymousWaitlistSessionEmail(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (
    normalized.startsWith("anon-") && normalized.endsWith("@agent-native.com")
  );
}

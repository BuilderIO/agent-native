export function normalizeOwnerEmail(
  email: string | null | undefined,
): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

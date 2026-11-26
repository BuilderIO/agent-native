interface ResolvedPrivateActionScope {
  email: string | undefined;
  orgId: string | null | undefined;
  authUserId: string | undefined;
}

/** Expectations constrain established authority; they never select it. */
export function privateActionScopeMatches(
  header: string,
  actual: ResolvedPrivateActionScope,
): boolean {
  if (header.length > 4096 || actual.orgId === undefined) return false;
  let value: unknown;
  try {
    value = JSON.parse(header);
  } catch {
    // coercion-ok: false rejects malformed scope before body consumption; it is never a match.
    return false;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expected = value as Record<string, unknown>;
  const keys = Object.keys(expected);
  if (
    keys.length !== 3 ||
    !keys.every(
      (key) => key === "email" || key === "orgId" || key === "authUserId",
    )
  )
    return false;
  if (
    typeof expected.email !== "string" ||
    !expected.email.trim() ||
    typeof expected.authUserId !== "string" ||
    !expected.authUserId.trim()
  )
    return false;
  if (
    expected.orgId !== null &&
    (typeof expected.orgId !== "string" || !expected.orgId.trim())
  )
    return false;
  return (
    expected.email.trim().toLowerCase() ===
      actual.email?.trim().toLowerCase() &&
    expected.authUserId.trim() === actual.authUserId?.trim() &&
    (typeof expected.orgId === "string" ? expected.orgId.trim() : null) ===
      (actual.orgId === null ? null : actual.orgId.trim())
  );
}

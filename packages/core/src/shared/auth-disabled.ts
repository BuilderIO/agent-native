/**
 * Whether `AUTH_DISABLED` turns on the shared sign-in bypass. Every reader of
 * the flag goes through this, so a warning or check never disagrees with the
 * bypass itself about which values count.
 */
export function isAuthDisabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env.AUTH_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}

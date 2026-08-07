import { getBetterAuthInternalAdapter } from "./better-auth-instance.js";

/**
 * Backfill the canonical Better Auth user for a verified legacy session.
 *
 * Older OAuth sessions were keyed by email in the framework `sessions` table
 * before every deployment required a Better Auth `user` row. Keep the legacy
 * session as the authentication proof, and use Better Auth's adapter only to
 * create the missing canonical user. Do not invent a provider account: the
 * next provider sign-in owns that link.
 */
export async function ensureCanonicalUserForLegacySession(
  email: string,
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) return false;

  const adapter = await getBetterAuthInternalAdapter();
  if (!adapter) {
    throw new Error("Better Auth internal adapter is unavailable");
  }

  const findExisting = () =>
    adapter.findUserByEmail(normalizedEmail, { includeAccounts: false });
  if (await findExisting()) return false;

  try {
    await adapter.createUser({
      email: normalizedEmail,
      name: normalizedEmail.split("@")[0] || "User",
      emailVerified: true,
    });
    return true;
  } catch (error) {
    // A concurrent request may have created the same canonical user. Treat
    // that race as success only after the adapter can read the winner.
    if (await findExisting()) return false;
    throw error;
  }
}

import { getBetterAuthInternalAdapter } from "./better-auth-instance.js";

export interface CanonicalLegacyUser {
  user: {
    id: string;
    email: string;
    name?: string;
    image?: string | null;
  };
  accounts: Array<{ id: string; providerId: string; accountId: string }>;
}

async function ensureCanonicalUser(
  email: string,
): Promise<{ user: CanonicalLegacyUser | null; created: boolean }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { user: null, created: false };
  }

  const adapter = await getBetterAuthInternalAdapter();
  if (!adapter) {
    throw new Error("Better Auth internal adapter is unavailable");
  }

  const findExisting = () =>
    adapter.findUserByEmail(normalizedEmail, { includeAccounts: false });
  const existing = await findExisting();
  if (existing) return { user: existing, created: false };

  const name = normalizedEmail.split("@")[0] || "User";
  try {
    const created = await adapter.createUser({
      email: normalizedEmail,
      name,
      emailVerified: true,
    });
    return {
      user: {
        user: { id: created.id, email: normalizedEmail, name },
        accounts: [],
      },
      created: true,
    };
  } catch (error) {
    // A concurrent request may have created the same canonical user. Treat
    // that race as success only after the adapter can read the winner.
    const winner = await findExisting();
    if (winner) return { user: winner, created: false };
    throw error;
  }
}

export async function resolveCanonicalUserForLegacySession(
  email: string,
): Promise<CanonicalLegacyUser | null> {
  return (await ensureCanonicalUser(email)).user;
}

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
  return (await ensureCanonicalUser(email)).created;
}

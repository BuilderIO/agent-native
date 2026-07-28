import { getRequestUserEmail } from "@agent-native/core/server";

/**
 * The authenticated owner for every read/write of user data (stays, rules,
 * visas, profile). Fails closed: no session → no data, never a shared
 * fallback identity.
 */
export function requireOwner(): string {
  const email = getRequestUserEmail();
  if (!email) {
    throw new Error(
      "Not authenticated — this data is per-user. Sign in (or set AGENT_USER_EMAIL for CLI runs).",
    );
  }
  return email;
}

import { APIError } from "better-auth/api";

import { getAppConfig } from "../app-config/index.js";
import { getDbExec } from "../db/client.js";
import { AUTH_SIGNUP_INVITE_ONLY_CODE } from "../shared/auth-copy.js";
import { hasAutoJoinDomainMatch } from "./auto-join-domain.js";

export const INVITE_ONLY_SIGNUP_CODE = AUTH_SIGNUP_INVITE_ONLY_CODE;

function isMissingInvitationsTable(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "42P01" ||
    /no such table: ["'`]?org_invitations|relation ["'`]?org_invitations["'`]? does not exist/i.test(
      String(candidate.message ?? error),
    )
  );
}

export function isBootstrapAdmin(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return getAppConfig().access.bootstrapAdmins.some(
    (admin) => admin.trim().toLowerCase() === normalized,
  );
}

export async function isSignupAdmitted(user: {
  email?: string | null;
  emailVerified?: boolean | null;
}): Promise<boolean> {
  const access = getAppConfig().access;
  if (access.signup === "open") return true;

  const email = user.email?.trim().toLowerCase();
  if (!email) return false;
  if (isBootstrapAdmin(email)) return true;

  try {
    const { rows: invitations } = await getDbExec().execute({
      sql: `SELECT 1 FROM org_invitations
            WHERE LOWER(email) = ? AND status = 'pending'
            LIMIT 1`,
      args: [email],
    });
    if (invitations.length > 0) return true;
  } catch (error) {
    if (!isMissingInvitationsTable(error)) throw error;
  }
  if (user.emailVerified !== true) return false;
  return hasAutoJoinDomainMatch(email);
}

/** The shared Better Auth user-create gate for password, magic-link, and social signup. */
export async function enforceSignupAdmission(
  user: {
    email?: string | null;
    emailVerified?: boolean | null;
  },
  context?: { path?: string | null } | null,
): Promise<void> {
  // SCIM has already authenticated the directory bearer and pins the request
  // to the configured provisioning domain. Keep this narrow path out of the
  // human signup gate while still enforcing the database hook for every other
  // Better Auth user creation (including social sign-in).
  if (
    getAppConfig().access.scim.enabled &&
    typeof context?.path === "string" &&
    /\/scim\/v2\/users(?:\/|$)/i.test(context.path)
  ) {
    return;
  }
  if (await isSignupAdmitted(user)) return;
  throw new APIError("FORBIDDEN", {
    message: INVITE_ONLY_SIGNUP_CODE,
  });
}

/**
 * Live organization-membership check for long-lived MCP credentials.
 *
 * MCP OAuth access and refresh tokens, authorization codes, and connect tokens
 * carry the organization they were issued for (a signed `org_id` claim or the
 * stored org of a connect token). Removing a member does not touch those
 * credentials, so the org they name is only an assertion from issuance time.
 * Every use re-checks it here: two indexed queries (the membership row, then
 * the organization row), plus a call to the identity authority when the org
 * is linked. Nothing is cached, so a removal on any instance takes effect on
 * the next request everywhere.
 */
import { getDbExec } from "../db/client.js";
import { readEmailRetiredAt } from "../identity/retired-emails.js";
import {
  isMissingOrganizationTableError,
  isOrgMember,
} from "../org/membership.js";
import { implicitServiceOrgRole } from "../org/service-identity.js";
import {
  getRequestContext,
  runWithRequestContext,
} from "../server/request-context.js";
import type { StoredConnectTokenIdentity } from "./connect-store.js";

/**
 * `unavailable` means the check could not run (database or identity-authority
 * error, or organization tables that don't exist yet). It is neither answer:
 * callers must refuse the request with a retryable error, and must not revoke
 * anything on it.
 */
export type CredentialOrgMembership = "member" | "not-member" | "unavailable";

export async function checkCredentialOrgMembership(input: {
  orgId: string;
  email: string | undefined;
  storedConnectToken?: StoredConnectTokenIdentity;
  /** This app's public origin; federated orgs need it to reach the identity authority. */
  requestOrigin?: string;
}): Promise<CredentialOrgMembership> {
  const orgId = input.orgId.trim();
  const email = input.email?.trim();
  if (!orgId || !email) return "not-member";
  // A human OAuth subject can use a service-shaped address. Only the local
  // record of an authenticated connect token proves it is a service identity.
  const stored = input.storedConnectToken;
  const lookup = () =>
    isOrgMember(orgId, email, { requireOrganizationMetadata: true });
  const context = getRequestContext();
  try {
    if (
      stored?.kind === "service" &&
      stored.ownerEmail === email &&
      stored.orgId === orgId &&
      implicitServiceOrgRole({ email, orgId, requestOrgId: stored.orgId })
    ) {
      const organization = await getDbExec().execute({
        sql: `SELECT identity_authority, identity_id
              FROM organizations WHERE id = ? LIMIT 1`,
        args: [orgId],
      });
      const metadata = organization.rows[0] as
        | { identity_authority?: unknown; identity_id?: unknown }
        | undefined;
      if (!metadata) return "not-member";
      return String(metadata.identity_authority ?? "").trim() ||
        String(metadata.identity_id ?? "").trim()
        ? "not-member"
        : "member";
    }

    const member =
      !input.requestOrigin || context?.requestOrigin
        ? await lookup()
        : await runWithRequestContext(
            { ...context, requestOrigin: input.requestOrigin },
            lookup,
          );
    return member ? "member" : "not-member";
  } catch (error) {
    // Missing organization tables mean a partial migration or a fresh
    // database, not a removal. Refuse with a retryable error; revoking a
    // refresh token on this could not be undone.
    if (isMissingOrganizationTableError(error)) {
      console.error(
        "[mcp] Organization tables are missing; refusing the credential without revoking it.",
      );
      return "unavailable";
    }
    console.error(
      "[mcp] Organization membership check failed; refusing the credential:",
      error,
    );
    return "unavailable";
  }
}

/**
 * `retired`: an email change moved this account off the credential's subject
 * address after the credential was signed. `unavailable` means the same as for
 * membership: refuse with a retryable error.
 */
export type CredentialEmailRetirement = "current" | "retired" | "unavailable";

export async function checkCredentialEmailRetirement(input: {
  email: string;
  /** The credential's `iat`, in seconds; absent counts as signed before. */
  issuedAt: number | undefined;
}): Promise<CredentialEmailRetirement> {
  try {
    const retiredAt = await readEmailRetiredAt(getDbExec(), input.email);
    if (retiredAt === null) return "current";
    // `iat` truncates to whole seconds, so a credential signed in the same
    // second as the rekey is refused.
    return input.issuedAt !== undefined && input.issuedAt * 1000 > retiredAt
      ? "current"
      : "retired";
  } catch (error) {
    console.error(
      "[mcp] Email retirement check failed; refusing the credential:",
      error,
    );
    return "unavailable";
  }
}

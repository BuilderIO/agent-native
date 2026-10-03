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
  if (
    stored?.kind === "service" &&
    stored.ownerEmail === email &&
    stored.orgId === orgId &&
    implicitServiceOrgRole({ email, orgId, requestOrgId: stored.orgId })
  ) {
    return "member";
  }
  const lookup = () =>
    isOrgMember(orgId, email, { requireOrganizationMetadata: true });
  const context = getRequestContext();
  try {
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

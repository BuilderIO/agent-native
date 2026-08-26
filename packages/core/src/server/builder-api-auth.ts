/**
 * Authorization for Builder.io REST asset calls (`/api/v1/upload/*`).
 *
 * Two credential kinds reach those endpoints and they are not interchangeable:
 * a legacy `bpk-` private key bypasses Builder's OAuth scope middleware
 * entirely, while an OAuth access token is checked against the scopes its
 * grant was issued with. New Builder connections store only an OAuth grant, so
 * a caller that knows about private keys alone cannot upload for them at all.
 */

import {
  getBuilderOAuthSession,
  hasBuilderOAuthSession,
} from "./builder-oauth.js";
import { resolveBuilderPrivateKey } from "./credential-provider.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

/**
 * Resolve the `Authorization` header for a Builder asset API call.
 *
 * OAuth wins whenever the request's owner has a grant. An unusable grant
 * throws rather than falling back to a private key: falling back would let a
 * deploy-level or stale `bpk-` key act for a user who never authorized it.
 *
 * @param requiredScope OAuth scope the endpoint enforces. Omit for endpoints
 * with no scope gate.
 */
export async function resolveBuilderApiAuthorization(
  requiredScope?: string,
): Promise<string> {
  const ownerEmail = getRequestUserEmail();
  // Bind to the request's organization, not the user's currently active one:
  // the grant is org-scoped, and a recording that finalizes after the user
  // switched org must still authorize against the org it belongs to. The
  // legacy private-key path already resolves this way.
  const orgId = getRequestOrgId();

  if (ownerEmail && (await hasBuilderOAuthSession(ownerEmail, orgId))) {
    const session = await getBuilderOAuthSession(ownerEmail, orgId);
    if (!session) {
      throw new Error(
        "Builder.io access expired. Re-authorize Builder.io in Settings to continue.",
      );
    }
    if (requiredScope && !session.scopes.includes(requiredScope)) {
      throw new Error(
        `Builder.io access needs re-authorizing to grant ${requiredScope}. Open Settings and authorize Builder.io again.`,
      );
    }
    return `Bearer ${session.accessToken}`;
  }

  const privateKey = await resolveBuilderPrivateKey();
  if (!privateKey) throw new Error("Builder.io is not connected.");
  return `Bearer ${privateKey}`;
}

/**
 * Whether Builder.io can authenticate an asset call for this request — an
 * OAuth grant, or a legacy private key.
 *
 * Storage gates and provider selection use this. It intentionally does not
 * verify the grant is usable: answering `false` for a connected user whose
 * grant needs re-authorizing would report storage as unconfigured and send
 * them to set up something they already have, instead of letting the upload
 * path say what is actually wrong.
 */
export async function hasBuilderApiCredentialCustody(): Promise<boolean> {
  const ownerEmail = getRequestUserEmail();
  if (
    ownerEmail &&
    (await hasBuilderOAuthSession(ownerEmail, getRequestOrgId()))
  ) {
    return true;
  }
  return !!(await resolveBuilderPrivateKey());
}

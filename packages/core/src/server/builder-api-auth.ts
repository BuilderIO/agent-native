/**
 * Authorization for authenticated Builder.io requests.
 *
 * Two credential kinds reach these endpoints and they are not interchangeable:
 * a legacy `bpk-` private key bypasses Builder's OAuth scope middleware
 * entirely, while an OAuth access token is checked against the scopes its
 * grant was issued with. New Builder connections store only an OAuth grant, so
 * every authenticated Builder caller must share this precedence decision.
 */

import { isTransientDatabaseError } from "../db/client.js";
import {
  getBuilderOAuthSession,
  hasBuilderOAuthSession,
} from "./builder-oauth.js";
import {
  CredentialStoreUnavailableError,
  resolveBuilderCredential,
} from "./credential-provider.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

async function readCredentialStore<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (isTransientDatabaseError(err)) {
      throw new CredentialStoreUnavailableError(err);
    }
    throw err;
  }
}

async function readOAuthCustody(
  ownerEmail: string,
  orgId?: string | null,
): Promise<boolean> {
  return readCredentialStore(() => hasBuilderOAuthSession(ownerEmail, orgId));
}

export type BuilderLegacyCredentialKey =
  | "BUILDER_PRIVATE_KEY"
  | "BUILDER_CMS_PRIVATE_KEY";

export interface BuilderRequestAuthorization {
  token: string;
  authorization: string;
  source: "oauth" | "legacy";
  legacyCredentialKey?: BuilderLegacyCredentialKey;
}

/**
 * Resolve the one effective authorization for an authenticated Builder
 * request. OAuth custody wins even when the grant needs reconnecting or lacks
 * a required scope; only a request with no OAuth custody may use a legacy key.
 */
export async function resolveBuilderRequestAuthorization(
  input: {
    requiredScope?: string;
    legacyCredentialKeys?: readonly BuilderLegacyCredentialKey[];
  } = {},
): Promise<BuilderRequestAuthorization | null> {
  const ownerEmail = getRequestUserEmail();
  const orgId = getRequestOrgId();

  if (ownerEmail && (await readOAuthCustody(ownerEmail, orgId))) {
    const session = await readCredentialStore(() =>
      getBuilderOAuthSession(ownerEmail, orgId),
    );
    if (!session) {
      throw new Error(
        "Builder.io access expired. Re-authorize Builder.io in Settings to continue.",
      );
    }
    if (input.requiredScope && !session.scopes.includes(input.requiredScope)) {
      throw new Error(
        `Builder.io access needs re-authorizing to grant ${input.requiredScope}. Open Settings and authorize Builder.io again.`,
      );
    }
    return {
      token: session.accessToken,
      authorization: `Bearer ${session.accessToken}`,
      source: "oauth",
    };
  }

  const legacyCredentialKeys = input.legacyCredentialKeys ?? [
    "BUILDER_PRIVATE_KEY",
  ];
  for (const key of legacyCredentialKeys) {
    const token = await resolveBuilderCredential(key);
    if (token) {
      return {
        token,
        authorization: `Bearer ${token}`,
        source: "legacy",
        legacyCredentialKey: key,
      };
    }
  }
  return null;
}

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
  const resolved = await resolveBuilderRequestAuthorization({ requiredScope });
  if (!resolved) throw new Error("Builder.io is not connected.");
  return resolved.authorization;
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
  if (ownerEmail && (await readOAuthCustody(ownerEmail, getRequestOrgId()))) {
    return true;
  }
  return !!(await resolveBuilderCredential("BUILDER_PRIVATE_KEY"));
}

/**
 * Whether the effective Builder credential can authorize an API request with
 * the requested scope. OAuth custody deliberately wins over deploy keys here.
 */
export async function canAuthorizeBuilderApiRequest(
  requiredScope?: string,
): Promise<boolean> {
  const ownerEmail = getRequestUserEmail();
  const orgId = getRequestOrgId();

  if (ownerEmail && (await hasBuilderOAuthSession(ownerEmail, orgId))) {
    const session = await getBuilderOAuthSession(ownerEmail, orgId);
    return (
      !!session && (!requiredScope || session.scopes.includes(requiredScope))
    );
  }

  return !!(await resolveBuilderCredential("BUILDER_PRIVATE_KEY"));
}

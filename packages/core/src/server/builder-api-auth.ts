/**
 * Authorization for authenticated Builder.io requests.
 *
 * Two credential kinds reach these endpoints and they are not interchangeable:
 * a legacy `bpk-` private key bypasses Builder's OAuth scope middleware
 * entirely, while an OAuth access token is checked against the scopes its
 * grant was issued with. New Builder connections store only an OAuth grant, so
 * every authenticated Builder caller must share this precedence decision.
 */

import { ActionContractError } from "../action.js";
import { isTransientDatabaseError } from "../db/client.js";
import { readMcpOAuthCredentials } from "../mcp-client/oauth-client.js";
import {
  listRemoteServers,
  toHttpServerConfigAsync,
  type RemoteMcpScope,
} from "../mcp-client/remote-store.js";
import {
  getBuilderOAuthSession,
  hasBuilderOAuthSession,
  type BuilderOAuthPermissionScope,
} from "./builder-oauth.js";
import {
  CredentialStoreUnavailableError,
  resolveBuilderCredential,
  resolveBuilderCredentials,
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

export const BUILDER_PUBLISH_MCP_RESOURCE =
  "https://mcp.builder.io/mcp/publish";
const BUILDER_PUBLISH_MCP_ISSUER = "https://mcp.builder.io";

function isBuilderPublishResource(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.origin === BUILDER_PUBLISH_MCP_ISSUER &&
    url.pathname.replace(/\/+$/, "") === "/mcp/publish" &&
    !url.search &&
    !url.hash
  );
}

export interface BuilderRequestAuthorization {
  token: string;
  authorization: string;
  source: "oauth" | "legacy";
  oauthScope?: RemoteMcpScope;
  legacyCredentialKey?: BuilderLegacyCredentialKey;
  legacyPublicKey?: string;
  userId?: string;
}

async function resolveBuilderPublishAuthorization(
  ownerEmail: string | undefined,
  orgId: string | null | undefined,
): Promise<BuilderRequestAuthorization | null> {
  const candidates: Array<{ scope: RemoteMcpScope; scopeId: string }> = orgId
    ? [{ scope: "org", scopeId: orgId }]
    : [];

  for (const candidate of candidates) {
    const server = (
      await listRemoteServers(candidate.scope, candidate.scopeId)
    ).find((entry) => {
      return isBuilderPublishResource(entry.url);
    });
    if (!server) continue;
    if (!server.oauthSecretKey) {
      throw new ActionContractError(
        "Builder Publish is configured without OAuth custody. Reconnect Builder.io Publish in Settings to continue.",
        {
          errorCode: "builder_oauth_reauthorization_required",
          statusCode: 400,
        },
      );
    }
    const credentials = await readMcpOAuthCredentials({
      key: server.oauthSecretKey,
      scope: candidate.scope,
      scopeId: candidate.scopeId,
      serverUrl: server.url,
    });
    const scopes = new Set(
      credentials?.tokens.scope?.split(/\s+/).filter(Boolean) ?? [],
    );
    const discovery = credentials?.discoveryState;
    const issuer = discovery?.authorizationServerMetadata?.issuer;
    const resource = discovery?.resourceMetadata?.resource;
    const authorizationServers =
      discovery?.resourceMetadata?.authorization_servers ?? [];
    const issuerBound =
      issuer === BUILDER_PUBLISH_MCP_ISSUER &&
      discovery?.authorizationServerUrl === BUILDER_PUBLISH_MCP_ISSUER &&
      credentials?.clientInformation.issuer === BUILDER_PUBLISH_MCP_ISSUER &&
      credentials?.tokens.issuer === BUILDER_PUBLISH_MCP_ISSUER &&
      authorizationServers.includes(BUILDER_PUBLISH_MCP_ISSUER);
    const resourceBound =
      typeof resource === "string" && isBuilderPublishResource(resource);
    if (
      !credentials ||
      !issuerBound ||
      !resourceBound ||
      !scopes.has("mcp:publish:read") ||
      [...scopes].some(
        (scope) => scope !== "mcp:publish:read" && scope !== "offline_access",
      )
    ) {
      throw new ActionContractError(
        "Builder Publish access needs re-authorizing to grant mcp:publish:read. Open Settings and reconnect Builder.io Publish.",
        {
          errorCode: "builder_oauth_reauthorization_required",
          statusCode: 400,
        },
      );
    }
    const config = await toHttpServerConfigAsync(
      candidate.scope,
      candidate.scopeId,
      server,
    );
    const authorization = config.headers?.Authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      throw new ActionContractError(
        "Builder Publish access expired. Reconnect Builder.io Publish in Settings to continue.",
        {
          errorCode: "builder_oauth_reauthorization_required",
          statusCode: 400,
        },
      );
    }
    return {
      token: match[1],
      authorization: `Bearer ${match[1]}`,
      source: "oauth",
      oauthScope: candidate.scope,
    };
  }
  if (ownerEmail) {
    const personalServer = (await listRemoteServers("user", ownerEmail)).find(
      (entry) => isBuilderPublishResource(entry.url),
    );
    if (personalServer) {
      throw new ActionContractError(
        "Builder Publish is connected only for this user. Remove it and reconnect Builder.io Publish for the workspace.",
        {
          errorCode: "builder_oauth_reauthorization_required",
          statusCode: 400,
        },
      );
    }
  }
  return null;
}

/**
 * Resolve the one effective authorization for an authenticated Builder
 * request. OAuth custody wins even when the grant needs reconnecting or lacks
 * a required scope; only a request with no OAuth custody may use a legacy key.
 */
export async function resolveBuilderRequestAuthorization(
  input: {
    requiredScope?: BuilderOAuthPermissionScope;
    oauthResource?: "general" | "publish";
    legacyCredentialKeys?: readonly BuilderLegacyCredentialKey[];
  } = {},
): Promise<BuilderRequestAuthorization | null> {
  const ownerEmail = getRequestUserEmail();
  const orgId = getRequestOrgId() ?? null;

  if (input.oauthResource === "publish") {
    const publishAuthorization = await readCredentialStore(() =>
      resolveBuilderPublishAuthorization(ownerEmail, orgId),
    );
    if (publishAuthorization) return publishAuthorization;
    if (ownerEmail && (await readOAuthCustody(ownerEmail, orgId))) {
      throw new ActionContractError(
        "Builder Publish access is not connected for this workspace. Connect Builder.io Publish in Settings to grant mcp:publish:read.",
        {
          errorCode: "builder_oauth_reauthorization_required",
          statusCode: 400,
        },
      );
    }
  }

  if (
    input.oauthResource !== "publish" &&
    ownerEmail &&
    (await readOAuthCustody(ownerEmail, orgId))
  ) {
    let session: Awaited<ReturnType<typeof getBuilderOAuthSession>>;
    try {
      session = await readCredentialStore(() =>
        getBuilderOAuthSession(ownerEmail, orgId, input.requiredScope),
      );
    } catch (err) {
      if (
        input.requiredScope &&
        err instanceof Error &&
        err.message ===
          `Builder OAuth connection does not grant ${input.requiredScope}`
      ) {
        throw new ActionContractError(
          `Builder.io access needs re-authorizing to grant ${input.requiredScope}. Open Settings and authorize Builder.io again.`,
          {
            errorCode: "builder_oauth_reauthorization_required",
            statusCode: 400,
          },
        );
      }
      throw err;
    }
    if (!session) {
      throw new ActionContractError(
        "Builder.io access expired. Re-authorize Builder.io in Settings to continue.",
        {
          errorCode: "builder_oauth_reauthorization_required",
          statusCode: 400,
        },
      );
    }
    if (input.requiredScope && !session.scopes.includes(input.requiredScope)) {
      throw new ActionContractError(
        `Builder.io access needs re-authorizing to grant ${input.requiredScope}. Open Settings and authorize Builder.io again.`,
        {
          errorCode: "builder_oauth_reauthorization_required",
          statusCode: 400,
        },
      );
    }
    return {
      token: session.accessToken,
      authorization: `Bearer ${session.accessToken}`,
      source: "oauth",
      oauthScope: session.scope,
    };
  }

  const legacyCredentialKeys = input.legacyCredentialKeys ?? [
    "BUILDER_PRIVATE_KEY",
  ];
  for (const key of legacyCredentialKeys) {
    if (key === "BUILDER_PRIVATE_KEY") {
      // Resolve the private key on its own, same as any other legacy key
      // below: a private-key-only tenant (no public key ever stored) still
      // authenticates every plain Bearer-token caller. resolveBuilderCredentials()
      // only returns a bundle when the private+public pair is complete, so it
      // is queried separately and purely to populate the public key/user id
      // that scope-gated callers (Fusion, design systems, browser) require.
      const privateKey = await resolveBuilderCredential(key);
      if (!privateKey) continue;
      const { publicKey, userId } = await resolveBuilderCredentials();
      return {
        token: privateKey,
        authorization: `Bearer ${privateKey}`,
        source: "legacy",
        legacyCredentialKey: key,
        legacyPublicKey: publicKey ?? undefined,
        userId: userId ?? undefined,
      };
    }

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
  requiredScope?: BuilderOAuthPermissionScope,
): Promise<string> {
  const resolved = await resolveBuilderRequestAuthorization({ requiredScope });
  if (!resolved) {
    throw new ActionContractError("Builder.io is not connected.", {
      errorCode: "builder_oauth_reauthorization_required",
      statusCode: 400,
    });
  }
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
  const orgId = getRequestOrgId() ?? null;
  if (ownerEmail && (await readOAuthCustody(ownerEmail, orgId))) {
    return true;
  }
  return !!(await resolveBuilderCredential("BUILDER_PRIVATE_KEY"));
}

/**
 * Whether the effective Builder credential can authorize an API request with
 * the requested scope. OAuth custody deliberately wins over deploy keys here.
 */
export async function canAuthorizeBuilderApiRequest(
  requiredScope?: BuilderOAuthPermissionScope,
): Promise<boolean> {
  const ownerEmail = getRequestUserEmail();
  const orgId = getRequestOrgId() ?? null;

  if (ownerEmail && (await hasBuilderOAuthSession(ownerEmail, orgId))) {
    try {
      const session = await getBuilderOAuthSession(
        ownerEmail,
        orgId,
        requiredScope,
      );
      return (
        !!session && (!requiredScope || session.scopes.includes(requiredScope))
      );
    } catch (err) {
      if (
        requiredScope &&
        err instanceof Error &&
        err.message ===
          `Builder OAuth connection does not grant ${requiredScope}`
      ) {
        return false;
      }
      throw err;
    }
  }

  return !!(await resolveBuilderCredential("BUILDER_PRIVATE_KEY"));
}

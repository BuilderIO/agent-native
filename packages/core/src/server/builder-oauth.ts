import { createHash } from "node:crypto";

import {
  finishMcpOAuthAuthorization,
  getMcpOAuthAccessToken,
  markMcpOAuthReconnectRequired,
  readMcpOAuthCredentials,
  revokeMcpOAuthCredentials,
  saveMcpOAuthCredentials,
  startMcpOAuthAuthorization,
  validateMcpOAuthCallbackIssuer,
  type McpOAuthCredentialBundle,
} from "../mcp-client/oauth-client.js";
import { getOAuthTokens } from "../oauth-tokens/store.js";
import { resolveOrgIdForEmail } from "../org/context.js";

export const BUILDER_OAUTH_ISSUER = "https://mcp.builder.io";
export const BUILDER_OAUTH_RESOURCE = "https://api.builder.io";
export const BUILDER_OAUTH_SCOPE = "builder:ai:invoke";
export const BUILDER_OAUTH_SCOPES = [BUILDER_OAUTH_SCOPE] as const;

// Folded with the owner so each owner gets their own (provider, account_id)
// row; a bare shared key would let only the first connector hold a grant.
const BUILDER_OAUTH_KEY = "builder-general-resource-v1";

export type BuilderOAuthPendingFlow = {
  codeVerifier: string;
  clientInformation: unknown;
  discoveryState?: unknown;
  redirectUri: string;
};

export type BuilderOAuthSession = {
  accessToken: string;
  expiresAt?: number;
  scopes: string[];
};

export type BuilderOAuthRequestAccess = BuilderOAuthSession & {
  ownerEmail: string;
};

// The Builder connection is shared by everyone in the caller's org: the
// credential is scoped to the org so every member reads the same token.
// Personal context (no org membership / active Personal) falls back to a
// per-user scope so solo users still get their own connection.
async function ownerOptions(ownerEmail: string) {
  const email = ownerEmail.trim().toLowerCase();
  if (!email) throw new Error("Builder OAuth owner email is required");
  const orgId = await resolveOrgIdForEmail(email);
  if (orgId) {
    return {
      key: builderOAuthKey("org", orgId),
      scope: "org" as const,
      scopeId: orgId,
      serverUrl: BUILDER_OAUTH_RESOURCE,
    };
  }
  return {
    key: builderOAuthKey("user", email),
    scope: "user" as const,
    scopeId: email,
    serverUrl: BUILDER_OAUTH_RESOURCE,
  };
}

function builderOAuthKey(scope: "user" | "org", id: string): string {
  const digest = createHash("sha256").update(id).digest("hex");
  return `${BUILDER_OAUTH_KEY}:${scope === "org" ? "o" : "u"}:${digest}`;
}

function scopesFrom(credentials: McpOAuthCredentialBundle): string[] {
  const declared = credentials.tokens.scope;
  if (typeof declared !== "string") return [...BUILDER_OAUTH_SCOPES];
  return declared.split(/\s+/).filter(Boolean);
}

function resourceUrlsMatch(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return left === right;
  }
}

function isBuilderDiscoveryState(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const discovery = value as {
    authorizationServerUrl?: unknown;
    authorizationServerMetadata?: { issuer?: unknown };
    resourceMetadata?: { resource?: unknown };
  };
  const resource = discovery.resourceMetadata?.resource;
  return (
    discovery.authorizationServerUrl === BUILDER_OAUTH_ISSUER &&
    discovery.authorizationServerMetadata?.issuer === BUILDER_OAUTH_ISSUER &&
    typeof resource === "string" &&
    resourceUrlsMatch(resource, BUILDER_OAUTH_RESOURCE)
  );
}

function isBuilderCredential(credentials: McpOAuthCredentialBundle): boolean {
  return (
    resourceUrlsMatch(credentials.serverUrl, BUILDER_OAUTH_RESOURCE) &&
    credentials.clientInformation.issuer === BUILDER_OAUTH_ISSUER &&
    credentials.tokens.issuer === BUILDER_OAUTH_ISSUER &&
    isBuilderDiscoveryState(credentials.discoveryState)
  );
}

export async function startBuilderOAuthAuthorization(input: {
  ownerEmail: string;
  redirectUri: string;
  state: string;
}): Promise<{ authorizationUrl: string; pending: BuilderOAuthPendingFlow }> {
  await ownerOptions(input.ownerEmail);
  const started = await startMcpOAuthAuthorization({
    serverUrl: BUILDER_OAUTH_RESOURCE,
    redirectUrl: input.redirectUri,
    state: input.state,
    scope: BUILDER_OAUTH_SCOPE,
  });
  return {
    authorizationUrl: started.authorizationUrl.toString(),
    pending: {
      codeVerifier: started.codeVerifier,
      clientInformation: started.clientInformation,
      discoveryState: started.discoveryState,
      redirectUri: input.redirectUri,
    },
  };
}

export async function finishBuilderOAuthAuthorization(input: {
  ownerEmail: string;
  code: string;
  iss?: string;
  pending: BuilderOAuthPendingFlow;
}): Promise<void> {
  validateMcpOAuthCallbackIssuer(
    input.pending.discoveryState as never,
    input.iss,
  );
  const result = await finishMcpOAuthAuthorization({
    serverUrl: BUILDER_OAUTH_RESOURCE,
    redirectUrl: input.pending.redirectUri,
    state: "callback-state-validated-by-route",
    codeVerifier: input.pending.codeVerifier,
    clientInformation: input.pending.clientInformation as never,
    discoveryState: input.pending.discoveryState as never,
    authorizationCode: input.code,
    iss: input.iss,
  });
  if (!isBuilderCredential(result.credentials)) {
    throw new Error(
      "Builder OAuth exchange returned credentials for another resource",
    );
  }
  await saveMcpOAuthCredentials({
    ...(await ownerOptions(input.ownerEmail)),
    credentials: result.credentials,
  });
}

export async function markBuilderOAuthReconnectRequired(
  ownerEmail: string,
): Promise<void> {
  await markMcpOAuthReconnectRequired(await ownerOptions(ownerEmail));
}

export async function getBuilderOAuthSession(
  ownerEmail: string,
): Promise<BuilderOAuthSession | null> {
  const options = await ownerOptions(ownerEmail);
  // Delegates refresh single-flight and reconnect latching to the shared
  // credential lifecycle; a null token covers missing, expired-unrefreshable,
  // and reconnect_required alike.
  const accessToken = await getMcpOAuthAccessToken(options);
  if (!accessToken) return null;
  const credentials = await readMcpOAuthCredentials(options);
  if (!credentials || !isBuilderCredential(credentials)) return null;
  return {
    accessToken,
    expiresAt: credentials.tokenExpiresAt,
    scopes: scopesFrom(credentials),
  };
}

export async function hasBuilderOAuthSession(
  ownerEmail: string,
): Promise<boolean> {
  const options = await ownerOptions(ownerEmail);
  const stored = await getOAuthTokens(
    "mcp",
    options.key,
    `${options.scope}:${options.scopeId}`,
  );
  return stored !== null;
}

export async function resolveBuilderOAuthRequestAccess(input: {
  ownerEmail: string;
  requiredScope: string;
}): Promise<BuilderOAuthRequestAccess | null> {
  const session = await getBuilderOAuthSession(input.ownerEmail);
  if (!session) return null;
  if (!session.scopes.includes(input.requiredScope)) {
    throw new Error(
      `Builder OAuth connection does not grant ${input.requiredScope}`,
    );
  }
  return { ...session, ownerEmail: input.ownerEmail.trim().toLowerCase() };
}

export async function deleteBuilderOAuthSession(
  ownerEmail: string,
): Promise<{ localDeleted: boolean; remoteRevoked: boolean }> {
  const options = await ownerOptions(ownerEmail);
  const result = await revokeMcpOAuthCredentials(options);
  return {
    localDeleted: result.local === "deleted",
    remoteRevoked: result.remote === "succeeded",
  };
}

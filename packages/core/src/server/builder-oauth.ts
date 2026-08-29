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
/** Enforced by Builder's `/api/v1/upload/*` endpoints; without it, no uploads. */
export const BUILDER_ASSETS_WRITE_SCOPE = "builder:assets:write";
export const BUILDER_OAUTH_SCOPES = [
  BUILDER_OAUTH_SCOPE,
  BUILDER_ASSETS_WRITE_SCOPE,
] as const;

// Folded with the owner so each owner gets their own (provider, account_id)
// row; a bare shared key would let only the first connector hold a grant.
const BUILDER_OAUTH_KEY = "builder-general-resource-v1";

// Builder's general AI resource metadata lives at a non-default path; the
// default api.builder.io well-known describes its Figma integration instead.
// Point discovery here so live metadata resolves to the api.builder.io resource
// and the mcp.builder.io authorization server.
const BUILDER_OAUTH_PROTECTED_RESOURCE_METADATA =
  "https://mcp.builder.io/.well-known/oauth-protected-resource/api";

export type BuilderOAuthPendingFlow = {
  codeVerifier: string;
  clientInformation: unknown;
  discoveryState?: unknown;
  redirectUri: string;
};

export type BuilderOAuthScope = "user" | "org";

export type BuilderOAuthSession = {
  accessToken: string;
  expiresAt?: number;
  scopes: string[];
  scope: BuilderOAuthScope;
};

export type BuilderOAuthRequestAccess = BuilderOAuthSession & {
  ownerEmail: string;
};

// Builder connections follow the same scope policy as legacy Builder keys:
// owner/admin writes are shared with the org, while a member's connection is
// personal and cannot replace the org grant.
function normalizeOwnerEmail(ownerEmail: string): string {
  const email = ownerEmail.trim().toLowerCase();
  if (!email) throw new Error("Builder OAuth owner email is required");
  return email;
}

function userOAuthKey(ownerEmail: string): string {
  const digest = createHash("sha256")
    .update(normalizeOwnerEmail(ownerEmail))
    .digest("hex");
  return `${BUILDER_OAUTH_KEY}:u:${digest}`;
}

function userOwnerOptions(ownerEmail: string) {
  const scopeId = normalizeOwnerEmail(ownerEmail);
  return {
    key: userOAuthKey(scopeId),
    scope: "user" as const,
    scopeId,
    serverUrl: BUILDER_OAUTH_RESOURCE,
  };
}

// Read paths try a member's personal grant first, then the org grant. An
// explicit orgId wins over the user's active org so background work stays
// bound to the organization that authorized it.
async function resolveBuilderOAuthOptions(
  ownerEmail: string,
  orgId?: string | null,
) {
  const email = normalizeOwnerEmail(ownerEmail);
  const userOptions = userOwnerOptions(email);
  const resolvedOrgId = orgId?.trim() || (await resolveOrgIdForEmail(email));
  return resolvedOrgId
    ? [userOptions, orgOwnerOptions(resolvedOrgId)]
    : [userOptions];
}

async function resolveBuilderOAuthOptionsForScope(
  ownerEmail: string,
  scope: BuilderOAuthScope,
  orgId?: string | null,
) {
  if (scope === "user") return [userOwnerOptions(ownerEmail)];
  const resolvedOrgId =
    orgId?.trim() || (await resolveOrgIdForEmail(ownerEmail));
  return resolvedOrgId ? [orgOwnerOptions(resolvedOrgId)] : [];
}

async function writeBuilderOAuthOptions(input: {
  ownerEmail: string;
  orgId?: string | null;
  role?: string | null;
}) {
  if (input.role === "owner" || input.role === "admin") {
    const orgId =
      input.orgId?.trim() || (await resolveOrgIdForEmail(input.ownerEmail));
    if (orgId) return orgOwnerOptions(orgId);
  }
  return userOwnerOptions(input.ownerEmail);
}

function orgOwnerOptions(orgId: string) {
  return {
    key: builderOAuthKey(orgId),
    scope: "org" as const,
    scopeId: orgId,
    serverUrl: BUILDER_OAUTH_RESOURCE,
  };
}

function builderOAuthKey(orgId: string): string {
  const digest = createHash("sha256").update(orgId).digest("hex");
  return `${BUILDER_OAUTH_KEY}:o:${digest}`;
}

/**
 * RFC 6749 §5.1 lets a token response omit `scope` when the grant matches what
 * was requested. Record what this flow asked for, so a stored credential always
 * states its own scopes: inferring them later cannot tell a new two-scope grant
 * from a pre-change AI-only one, and either guess is wrong for the other.
 */
function withRecordedScopes(
  credentials: McpOAuthCredentialBundle,
): McpOAuthCredentialBundle {
  if (typeof credentials.tokens.scope === "string") return credentials;
  return {
    ...credentials,
    tokens: { ...credentials.tokens, scope: BUILDER_OAUTH_SCOPES.join(" ") },
  };
}

// Builder's token endpoint always sets `scope`, and `withRecordedScopes` backs
// that up for anything this flow stores, so an absent claim can only be a grant
// predating both. Those were AI-only and must not be credited with an upload
// scope the user never consented to.
function scopesFrom(credentials: McpOAuthCredentialBundle): string[] {
  const declared = credentials.tokens.scope;
  if (typeof declared !== "string") return [BUILDER_OAUTH_SCOPE];
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
  // Start scopes nothing, so it validates the email without an org lookup;
  // the org scope is resolved when the grant is stored and read.
  normalizeOwnerEmail(input.ownerEmail);
  const started = await startMcpOAuthAuthorization({
    serverUrl: BUILDER_OAUTH_RESOURCE,
    redirectUrl: input.redirectUri,
    state: input.state,
    scope: BUILDER_OAUTH_SCOPES.join(" "),
    resourceMetadataUrl: BUILDER_OAUTH_PROTECTED_RESOURCE_METADATA,
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

export async function exchangeBuilderOAuthAuthorization(input: {
  ownerEmail: string;
  code: string;
  iss?: string;
  pending: BuilderOAuthPendingFlow;
}): Promise<McpOAuthCredentialBundle> {
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
  return withRecordedScopes(result.credentials);
}

export async function saveBuilderOAuthCredentials(input: {
  ownerEmail: string;
  orgId?: string | null;
  role?: string | null;
  credentials: McpOAuthCredentialBundle;
}): Promise<BuilderOAuthScope> {
  const options = await writeBuilderOAuthOptions(input);
  await saveMcpOAuthCredentials({
    ...options,
    credentials: input.credentials,
  });
  return options.scope;
}

export async function finishBuilderOAuthAuthorization(input: {
  ownerEmail: string;
  orgId?: string | null;
  role?: string | null;
  code: string;
  iss?: string;
  pending: BuilderOAuthPendingFlow;
}): Promise<void> {
  const credentials = await exchangeBuilderOAuthAuthorization(input);
  await saveBuilderOAuthCredentials({
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
    role: input.role,
    credentials,
  });
}

export async function markBuilderOAuthReconnectRequired(
  ownerEmail: string,
  scope?: BuilderOAuthScope,
  orgId?: string | null,
): Promise<void> {
  const options = scope
    ? await resolveBuilderOAuthOptionsForScope(ownerEmail, scope, orgId)
    : await resolveBuilderOAuthOptions(ownerEmail, orgId);
  for (const candidate of options) {
    if (
      (await getOAuthTokens(
        "mcp",
        candidate.key,
        `${candidate.scope}:${candidate.scopeId}`,
      )) !== null
    ) {
      await markMcpOAuthReconnectRequired(candidate);
      return;
    }
  }
}

export async function getBuilderOAuthSession(
  ownerEmail: string,
  orgId?: string | null,
): Promise<BuilderOAuthSession | null> {
  for (const options of await resolveBuilderOAuthOptions(ownerEmail, orgId)) {
    const stored = await getOAuthTokens(
      "mcp",
      options.key,
      `${options.scope}:${options.scopeId}`,
    );
    if (stored === null) continue;
    // Delegates refresh single-flight and reconnect latching to the shared
    // credential lifecycle; a null token covers expired-unrefreshable and
    // reconnect_required alike, so an org fallback can still be used.
    const accessToken = await getMcpOAuthAccessToken(options);
    if (!accessToken) continue;
    const credentials = await readMcpOAuthCredentials(options);
    if (!credentials || !isBuilderCredential(credentials)) continue;
    return {
      accessToken,
      expiresAt: credentials.tokenExpiresAt,
      scopes: scopesFrom(credentials),
      scope: options.scope,
    };
  }
  return null;
}

export async function hasBuilderOAuthSession(
  ownerEmail: string,
  orgId?: string | null,
): Promise<boolean> {
  for (const options of await resolveBuilderOAuthOptions(ownerEmail, orgId)) {
    const stored = await getOAuthTokens(
      "mcp",
      options.key,
      `${options.scope}:${options.scopeId}`,
    );
    if (stored !== null) return true;
  }
  return false;
}

export async function getBuilderOAuthConnectionScope(
  ownerEmail: string,
  orgId?: string | null,
): Promise<BuilderOAuthScope | null> {
  for (const options of await resolveBuilderOAuthOptions(ownerEmail, orgId)) {
    const stored = await getOAuthTokens(
      "mcp",
      options.key,
      `${options.scope}:${options.scopeId}`,
    );
    if (stored !== null) return options.scope;
  }
  return null;
}

export async function resolveBuilderOAuthRequestAccess(input: {
  ownerEmail: string;
  requiredScope: string;
  orgId?: string | null;
}): Promise<BuilderOAuthRequestAccess | null> {
  const session = await getBuilderOAuthSession(input.ownerEmail, input.orgId);
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
  scope?: BuilderOAuthScope,
  orgId?: string | null,
): Promise<{ localDeleted: boolean; remoteRevoked: boolean }> {
  const options = scope
    ? await resolveBuilderOAuthOptionsForScope(ownerEmail, scope, orgId)
    : await resolveBuilderOAuthOptions(ownerEmail, orgId);
  let selected: (typeof options)[number] | null = null;
  for (const candidate of options) {
    if (
      (await getOAuthTokens(
        "mcp",
        candidate.key,
        `${candidate.scope}:${candidate.scopeId}`,
      )) !== null
    ) {
      selected = candidate;
      break;
    }
  }
  if (!selected) return { localDeleted: false, remoteRevoked: false };
  const result = await revokeMcpOAuthCredentials(selected);
  return {
    localDeleted: result.local === "deleted",
    remoteRevoked: result.remote === "succeeded",
  };
}

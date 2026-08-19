import {
  finishMcpOAuthAuthorization,
  getMcpOAuthAccessToken,
  readMcpOAuthCredentials,
  revokeMcpOAuthCredentials,
  saveMcpOAuthCredentials,
  startMcpOAuthAuthorization,
  validateMcpOAuthCallbackIssuer,
  type McpOAuthCredentialBundle,
  type McpOAuthDiscoveryState,
} from "../mcp-client/oauth-client.js";
import { getOAuthTokens } from "../oauth-tokens/store.js";
import { getSetting, mutateSetting, putSetting } from "../settings/store.js";

export const BUILDER_OAUTH_ISSUER = "https://mcp.builder.io";
export const BUILDER_OAUTH_RESOURCE = "https://api.builder.io";
export const BUILDER_OAUTH_PROTECTED_RESOURCE_METADATA =
  "https://mcp.builder.io/.well-known/oauth-protected-resource/api";
export const BUILDER_OAUTH_AUTHORIZATION_METADATA =
  "https://mcp.builder.io/.well-known/oauth-authorization-server";
export const BUILDER_OAUTH_AUTHORIZATION_ENDPOINT =
  "https://mcp.builder.io/oauth/authorize";
export const BUILDER_OAUTH_TOKEN_ENDPOINT =
  "https://mcp.builder.io/oauth/token";
export const BUILDER_OAUTH_REGISTRATION_ENDPOINT =
  "https://mcp.builder.io/oauth/register";
export const BUILDER_OAUTH_REVOCATION_ENDPOINT =
  "https://mcp.builder.io/oauth/revoke";
export const BUILDER_OAUTH_SCOPE = "builder:ai:invoke";
export const BUILDER_OAUTH_SCOPES = [BUILDER_OAUTH_SCOPE] as const;

const BUILDER_OAUTH_KEY = "builder-general-resource-v1";
const REFRESH_SKEW_MS = 60_000;
const REFRESH_LEASE_MS = 15_000;
const REFRESH_WAIT_MS = 50;

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

function ownerOptions(ownerEmail: string) {
  const scopeId = ownerEmail.trim().toLowerCase();
  if (!scopeId) throw new Error("Builder OAuth owner email is required");
  return {
    key: BUILDER_OAUTH_KEY,
    scope: "user" as const,
    scopeId,
    serverUrl: BUILDER_OAUTH_RESOURCE,
  };
}

function refreshLeaseKey(ownerEmail: string): string {
  return `builder-oauth-refresh:user:${ownerOptions(ownerEmail).scopeId}`;
}

function reconnectKey(ownerEmail: string): string {
  return `builder-oauth-reconnect:user:${ownerOptions(ownerEmail).scopeId}`;
}

function discoveryState(): McpOAuthDiscoveryState {
  return {
    authorizationServerUrl: BUILDER_OAUTH_ISSUER,
    authorizationServerMetadata: {
      issuer: BUILDER_OAUTH_ISSUER,
      authorization_endpoint: BUILDER_OAUTH_AUTHORIZATION_ENDPOINT,
      token_endpoint: BUILDER_OAUTH_TOKEN_ENDPOINT,
      registration_endpoint: BUILDER_OAUTH_REGISTRATION_ENDPOINT,
      revocation_endpoint: BUILDER_OAUTH_REVOCATION_ENDPOINT,
      // MCP SDK auth() reads these from the provided discovery blob and throws
      // if they are missing — do not omit them when skipping live metadata fetch.
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
    },
    resourceMetadataUrl: BUILDER_OAUTH_PROTECTED_RESOURCE_METADATA,
    resourceMetadata: {
      resource: BUILDER_OAUTH_RESOURCE,
      authorization_servers: [BUILDER_OAUTH_ISSUER],
    },
  } as McpOAuthDiscoveryState;
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
    authorizationServerMetadata?: Record<string, unknown>;
    resourceMetadataUrl?: unknown;
    resourceMetadata?: {
      resource?: unknown;
      authorization_servers?: unknown;
    };
  };
  const authorizationServers =
    discovery.resourceMetadata?.authorization_servers;
  const responseTypes =
    discovery.authorizationServerMetadata?.response_types_supported;
  const grantTypes =
    discovery.authorizationServerMetadata?.grant_types_supported;
  const challengeMethods =
    discovery.authorizationServerMetadata?.code_challenge_methods_supported;
  const resource =
    typeof discovery.resourceMetadata?.resource === "string"
      ? discovery.resourceMetadata.resource
      : null;
  return (
    discovery?.authorizationServerUrl === BUILDER_OAUTH_ISSUER &&
    discovery.authorizationServerMetadata?.issuer === BUILDER_OAUTH_ISSUER &&
    discovery.authorizationServerMetadata?.authorization_endpoint ===
      BUILDER_OAUTH_AUTHORIZATION_ENDPOINT &&
    discovery.authorizationServerMetadata?.token_endpoint ===
      BUILDER_OAUTH_TOKEN_ENDPOINT &&
    discovery.authorizationServerMetadata?.registration_endpoint ===
      BUILDER_OAUTH_REGISTRATION_ENDPOINT &&
    discovery.authorizationServerMetadata?.revocation_endpoint ===
      BUILDER_OAUTH_REVOCATION_ENDPOINT &&
    Array.isArray(responseTypes) &&
    responseTypes.includes("code") &&
    Array.isArray(grantTypes) &&
    grantTypes.includes("authorization_code") &&
    Array.isArray(challengeMethods) &&
    challengeMethods.includes("S256") &&
    discovery.resourceMetadataUrl ===
      BUILDER_OAUTH_PROTECTED_RESOURCE_METADATA &&
    !!resource &&
    resourceUrlsMatch(resource, BUILDER_OAUTH_RESOURCE) &&
    Array.isArray(authorizationServers) &&
    authorizationServers.includes(BUILDER_OAUTH_ISSUER)
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

function sessionFrom(
  credentials: McpOAuthCredentialBundle,
): BuilderOAuthSession | null {
  if (!isBuilderCredential(credentials)) return null;
  const accessToken = credentials.tokens.access_token;
  if (typeof accessToken !== "string" || !accessToken) return null;
  return {
    accessToken,
    expiresAt: credentials.tokenExpiresAt,
    scopes: scopesFrom(credentials),
  };
}

export async function startBuilderOAuthAuthorization(input: {
  ownerEmail: string;
  redirectUri: string;
  state: string;
}): Promise<{ authorizationUrl: string; pending: BuilderOAuthPendingFlow }> {
  ownerOptions(input.ownerEmail);
  const started = await startMcpOAuthAuthorization({
    serverUrl: BUILDER_OAUTH_RESOURCE,
    redirectUrl: input.redirectUri,
    state: input.state,
    scope: BUILDER_OAUTH_SCOPE,
    discoveryState: discoveryState(),
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
  if (!isBuilderDiscoveryState(input.pending.discoveryState)) {
    throw new Error(
      "Builder OAuth pending flow has an invalid discovery binding",
    );
  }
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
    ...ownerOptions(input.ownerEmail),
    credentials: result.credentials,
  });
  await putSetting(reconnectKey(input.ownerEmail), {
    required: false,
    at: Date.now(),
  }).catch(() => {
    // coercion-ok: reconnect flag clear is best-effort after a successful grant.
  });
}

export async function markBuilderOAuthReconnectRequired(
  ownerEmail: string,
): Promise<void> {
  await putSetting(reconnectKey(ownerEmail), {
    required: true,
    at: Date.now(),
  });
}

export async function builderOAuthReconnectRequired(
  ownerEmail: string,
): Promise<boolean> {
  const row = await getSetting(reconnectKey(ownerEmail));
  return row?.required === true;
}

export async function getBuilderOAuthSession(
  ownerEmail: string,
): Promise<BuilderOAuthSession | null> {
  if (await builderOAuthReconnectRequired(ownerEmail)) return null;
  const credentials = await readMcpOAuthCredentials(ownerOptions(ownerEmail));
  if (!credentials || !isBuilderCredential(credentials)) return null;
  if (
    typeof credentials.tokenExpiresAt === "number" &&
    credentials.tokenExpiresAt - Date.now() <= REFRESH_SKEW_MS
  ) {
    return refreshBuilderOAuthSession(ownerEmail);
  }
  return sessionFrom(credentials);
}

export async function hasBuilderOAuthSession(
  ownerEmail: string,
): Promise<boolean> {
  const options = ownerOptions(ownerEmail);
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
  return { ...session, ownerEmail: ownerOptions(input.ownerEmail).scopeId };
}

async function refreshBuilderOAuthSession(
  ownerEmail: string,
): Promise<BuilderOAuthSession | null> {
  const owner = crypto.randomUUID();
  const leaseKey = refreshLeaseKey(ownerEmail);
  const lease = await mutateSetting(leaseKey, (current) => {
    if (
      typeof current?.expiresAt !== "number" ||
      current.expiresAt <= Date.now()
    ) {
      return { owner, expiresAt: Date.now() + REFRESH_LEASE_MS };
    }
    return current;
  });

  if (lease.owner !== owner) return waitForRefreshedSession(ownerEmail);

  try {
    const options = ownerOptions(ownerEmail);
    const accessToken = await getMcpOAuthAccessToken(options);
    const next = await readMcpOAuthCredentials(options);
    if (!accessToken || !next || !isBuilderCredential(next)) {
      throw new Error("Builder OAuth refresh failed");
    }
    return sessionFrom(next);
  } catch {
    await markBuilderOAuthReconnectRequired(ownerEmail);
    return null;
  } finally {
    await mutateSetting(leaseKey, (current) =>
      current?.owner === owner ? { owner: "", expiresAt: 0 } : (current ?? {}),
    );
  }
}

async function waitForRefreshedSession(
  ownerEmail: string,
): Promise<BuilderOAuthSession | null> {
  for (let waited = 0; waited < REFRESH_LEASE_MS; waited += REFRESH_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));
    const credentials = await readMcpOAuthCredentials(ownerOptions(ownerEmail));
    if (!credentials || !isBuilderCredential(credentials)) return null;
    if (
      typeof credentials.tokenExpiresAt !== "number" ||
      credentials.tokenExpiresAt - Date.now() <= REFRESH_SKEW_MS
    ) {
      continue;
    }
    return sessionFrom(credentials);
  }
  return null;
}

export async function deleteBuilderOAuthSession(
  ownerEmail: string,
): Promise<{ localDeleted: boolean; remoteRevoked: boolean }> {
  const options = ownerOptions(ownerEmail);
  const result = await revokeMcpOAuthCredentials(options);
  await putSetting(reconnectKey(ownerEmail), {
    required: false,
    at: Date.now(),
  }).catch(() => {
    // coercion-ok: reconnect flag clear is best-effort after local revoke.
  });
  return {
    localDeleted: result.local === "deleted",
    remoteRevoked: result.remote === "succeeded",
  };
}

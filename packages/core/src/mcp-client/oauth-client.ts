/**
 * OAuth 2.1 client support for remote MCP servers.
 *
 * MCP servers advertise their OAuth endpoints through the standard protected
 * resource and authorization-server metadata documents. The SDK handles the
 * protocol details; this module owns the framework-specific encrypted storage
 * and refresh boundary.
 */

import {
  auth,
  refreshAuthorization,
  validateAuthorizationResponseIssuer,
  type AuthorizationServerMetadata,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  OAuthProtectedResourceMetadata,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  OAuthTokens,
} from "@modelcontextprotocol/client";

import { ssrfSafeFetch } from "../extensions/url-safety.js";
import {
  readOAuthCredentialState,
  resolveOAuthCredentialAccess,
  revokeOAuthCredential,
  saveOAuthCredential,
  type OAuthCredential,
  type OAuthCredentialIdentity,
  type OAuthCredentialState,
  type OAuthRevocationResult,
} from "../oauth-tokens/lifecycle.js";
import { validateRemoteUrl } from "./remote-url.js";

const TOKEN_EXPIRY_SKEW_MS = 60_000;
const MAX_OAUTH_REDIRECTS = 5;
const MCP_OAUTH_PRIVATE_ORIGINS_ENV = "AGENT_NATIVE_MCP_OAUTH_PRIVATE_ORIGINS";

type GuardedFetch = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response>;

function checkedRemoteUrl(value: string | URL, label: string): URL {
  const result = validateRemoteUrl(String(value));
  if (!result.ok || !result.url) {
    throw new Error(
      `MCP OAuth ${label} is not allowed: ${result.error ?? "invalid URL"}`,
    );
  }
  return result.url;
}

function canonicalServerUrl(value: string): string {
  return checkedRemoteUrl(value, "server").toString();
}

function serverUrlsMatch(stored: string, canonical: string): boolean {
  try {
    return canonicalServerUrl(stored) === canonical;
  } catch {
    return false;
  }
}

function guardedOAuthFetch(): GuardedFetch {
  const allowedPrivateOrigins = (
    process.env[MCP_OAUTH_PRIVATE_ORIGINS_ENV] ?? ""
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return async (url, init) => {
    let currentUrl = checkedRemoteUrl(url, "request");
    let currentInit: RequestInit = { ...init, redirect: "manual" };

    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await ssrfSafeFetch(currentUrl.href, currentInit, {
        maxRedirects: 0,
        followRedirects: false,
        allowedPrivateOrigins,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }
      if (redirectCount >= MAX_OAUTH_REDIRECTS) {
        throw new Error("MCP OAuth redirect limit exceeded.");
      }
      const location = response.headers.get("location");
      if (!location) throw new Error("MCP OAuth redirect is missing a target.");

      let nextUrl: URL;
      try {
        nextUrl = checkedRemoteUrl(
          new URL(location, currentUrl),
          "redirect target",
        );
      } catch {
        throw new Error("MCP OAuth redirect target is not allowed.");
      }
      await response.body?.cancel().catch(() => undefined);

      const nextHeaders = new Headers(currentInit.headers);
      const changesOrigin = nextUrl.origin !== currentUrl.origin;
      if (changesOrigin) {
        nextHeaders.delete("authorization");
        nextHeaders.delete("cookie");
        nextHeaders.delete("proxy-authorization");
        if (
          (response.status === 307 || response.status === 308) &&
          currentInit.body != null
        ) {
          throw new Error(
            "MCP OAuth redirect cannot forward a request body across origins.",
          );
        }
      }
      const nextInit: RequestInit = {
        ...currentInit,
        headers: nextHeaders,
      };
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          (currentInit.method ?? "GET").toUpperCase() === "POST")
      ) {
        nextInit.method = "GET";
        delete nextInit.body;
        nextHeaders.delete("content-length");
        nextHeaders.delete("content-type");
      }
      currentUrl = nextUrl;
      currentInit = nextInit;
    }
  };
}

async function guardedRevocationFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const endpoint = checkedRemoteUrl(url, "revocation endpoint");
  return ssrfSafeFetch(endpoint.href, init, {
    maxRedirects: 0,
    httpsOnly: true,
    assertUrlAllowed: (candidate) => {
      const checked = checkedRemoteUrl(candidate, "revocation redirect");
      if (checked.origin !== endpoint.origin) {
        throw new Error("MCP OAuth revocation redirect changed origin.");
      }
    },
  });
}

function validateDiscoveryUrls(state: {
  authorizationServerUrl: string;
  authorizationServerMetadata?: AuthorizationServerMetadata;
  resourceMetadata?: OAuthProtectedResourceMetadata;
  resourceMetadataUrl?: string;
}): void {
  checkedRemoteUrl(state.authorizationServerUrl, "authorization server");
  if (state.resourceMetadataUrl) {
    checkedRemoteUrl(state.resourceMetadataUrl, "resource metadata");
  }
  for (const url of state.resourceMetadata?.authorization_servers ?? []) {
    checkedRemoteUrl(url, "discovered authorization server");
  }
  for (const field of [
    "authorization_endpoint",
    "token_endpoint",
    "registration_endpoint",
    "introspection_endpoint",
    "revocation_endpoint",
  ] as const) {
    const url = (
      state.authorizationServerMetadata as Record<string, unknown> | undefined
    )?.[field];
    if (typeof url === "string") {
      checkedRemoteUrl(url, `OAuth ${field}`);
    }
  }
}

export type McpOAuthDiscoveryState = OAuthDiscoveryState;

export interface McpOAuthCredentialBundle extends OAuthCredential {
  serverUrl: string;
  clientInformation: StoredOAuthClientInformation;
  discoveryState?: McpOAuthDiscoveryState;
  tokens: StoredOAuthTokens;
  tokenExpiresAt?: number;
}

export interface McpOAuthStartResult {
  authorizationUrl: URL;
  codeVerifier: string;
  state: string;
  clientInformation: StoredOAuthClientInformation;
  discoveryState?: McpOAuthDiscoveryState;
}

export interface McpOAuthCallbackResult {
  credentials: McpOAuthCredentialBundle;
}

export interface McpOAuthProviderOptions {
  serverUrl: string;
  redirectUrl: string;
  state: string;
  clientInformation?: StoredOAuthClientInformation;
  codeVerifier?: string;
  discoveryState?: McpOAuthDiscoveryState;
}

function issuerForDiscovery(
  discovery: McpOAuthDiscoveryState | undefined,
): string | undefined {
  const issuer = discovery?.authorizationServerMetadata?.issuer;
  return typeof issuer === "string" && issuer ? issuer : undefined;
}

function credentialIdentity(options: {
  key: string;
  scope: "user" | "org";
  scopeId: string;
  serverUrl: string;
}): OAuthCredentialIdentity {
  return {
    provider: "mcp",
    accountId: options.key,
    resource: options.serverUrl,
    owner: { scope: options.scope, id: options.scopeId },
  };
}

function withIssuer<T extends { issuer?: string }>(
  value: T,
  context: OAuthClientInformationContext | undefined,
): T {
  if (value.issuer && context?.issuer && value.issuer !== context.issuer) {
    throw new Error("MCP OAuth credential issuer does not match discovery");
  }
  const issuer = context?.issuer ?? value.issuer;
  return issuer ? { ...value, issuer } : value;
}

function isBoundToIssuer(
  value: { issuer?: string } | undefined,
  context: OAuthClientInformationContext | undefined,
): boolean {
  return !context?.issuer || value?.issuer === context.issuer;
}

function applicationTypeForRedirect(redirectUrl: string): "native" | "web" {
  const url = new URL(redirectUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]"
  ) {
    return "native";
  }
  return "web";
}

/**
 * A small adapter around the MCP SDK's OAuth provider interface. The route
 * stores the adapter's state in an encrypted, short-lived browser cookie; the
 * durable credential bundle is written only after the callback succeeds.
 */
export class McpOAuthClientProvider implements OAuthClientProvider {
  private readonly redirectUrlValue: string;
  private readonly stateValue: string;
  private readonly metadata: OAuthClientMetadata;
  private clientInfo?: StoredOAuthClientInformation;
  private savedTokens?: StoredOAuthTokens;
  private savedCodeVerifier?: string;
  private savedDiscovery?: McpOAuthDiscoveryState;
  private authorizationUrl?: URL;

  constructor(options: McpOAuthProviderOptions) {
    this.redirectUrlValue = options.redirectUrl;
    this.stateValue = options.state;
    this.clientInfo = options.clientInformation;
    this.savedCodeVerifier = options.codeVerifier;
    this.savedDiscovery = options.discoveryState;
    const recordedIssuer = issuerForDiscovery(this.savedDiscovery);
    if (
      this.clientInfo &&
      !this.clientInfo.issuer &&
      recordedIssuer &&
      this.savedCodeVerifier
    ) {
      // A callback flow persists registration, discovery, PKCE, and state in
      // one encrypted cookie. Binding that pre-v2 in-flight registration to
      // its recorded issuer is safe; durable credentials are never inferred.
      this.clientInfo = { ...this.clientInfo, issuer: recordedIssuer };
    }
    this.metadata = {
      redirect_uris: [options.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: applicationTypeForRedirect(options.redirectUrl),
      client_name: "Agent Native MCP connector",
    };
  }

  get redirectUrl(): string {
    return this.redirectUrlValue;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.metadata;
  }

  state(): string {
    return this.stateValue;
  }

  clientInformation(
    context?: OAuthClientInformationContext,
  ): StoredOAuthClientInformation | undefined {
    return isBoundToIssuer(this.clientInfo, context)
      ? this.clientInfo
      : undefined;
  }

  saveClientInformation(
    info: StoredOAuthClientInformation,
    context?: OAuthClientInformationContext,
  ): void {
    this.clientInfo = withIssuer(info, context);
  }

  tokens(
    context?: OAuthClientInformationContext,
  ): StoredOAuthTokens | undefined {
    return isBoundToIssuer(this.savedTokens, context)
      ? this.savedTokens
      : undefined;
  }

  saveTokens(
    tokens: StoredOAuthTokens,
    context?: OAuthClientInformationContext,
  ): void {
    this.savedTokens = withIssuer(tokens, context);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = checkedRemoteUrl(
      authorizationUrl,
      "authorization redirect",
    );
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.savedCodeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.savedCodeVerifier) {
      throw new Error("MCP OAuth code verifier is missing");
    }
    return this.savedCodeVerifier;
  }

  saveDiscoveryState(state: {
    authorizationServerUrl: string;
    authorizationServerMetadata?: AuthorizationServerMetadata;
    resourceMetadata?: OAuthProtectedResourceMetadata;
    resourceMetadataUrl?: string;
  }): void {
    validateDiscoveryUrls(state);
    this.savedDiscovery = state;
  }

  discoveryState(): McpOAuthDiscoveryState | undefined {
    return this.savedDiscovery;
  }

  get authorizationRedirect(): URL | undefined {
    return this.authorizationUrl;
  }

  get savedCodeVerifierValue(): string | undefined {
    return this.savedCodeVerifier;
  }

  get savedTokensValue(): OAuthTokens | undefined {
    return this.savedTokens;
  }

  get savedClientInformation(): StoredOAuthClientInformation | undefined {
    return this.clientInfo;
  }
}

export async function startMcpOAuthAuthorization(
  options: McpOAuthProviderOptions & { scope?: string },
): Promise<McpOAuthStartResult> {
  checkedRemoteUrl(options.serverUrl, "server");
  const provider = new McpOAuthClientProvider(options);
  const result = await auth(provider, {
    serverUrl: options.serverUrl,
    scope: options.scope,
    fetchFn: guardedOAuthFetch(),
  });
  if (result !== "REDIRECT" || !provider.authorizationRedirect) {
    throw new Error("MCP server did not start an interactive OAuth flow");
  }
  const clientInformation = provider.savedClientInformation;
  if (!clientInformation) {
    throw new Error("MCP OAuth client registration did not complete");
  }
  return {
    authorizationUrl: provider.authorizationRedirect,
    codeVerifier: provider.savedCodeVerifierValue ?? provider.codeVerifier(),
    state: options.state,
    clientInformation,
    discoveryState: provider.discoveryState(),
  };
}

export async function finishMcpOAuthAuthorization(
  options: McpOAuthProviderOptions & {
    authorizationCode: string;
    iss?: string;
  },
): Promise<McpOAuthCallbackResult> {
  checkedRemoteUrl(options.serverUrl, "server");
  const provider = new McpOAuthClientProvider(options);
  const result = await auth(provider, {
    serverUrl: options.serverUrl,
    authorizationCode: options.authorizationCode,
    iss: options.iss,
    fetchFn: guardedOAuthFetch(),
  });
  if (result !== "AUTHORIZED" || !provider.savedTokensValue) {
    throw new Error("MCP OAuth token exchange did not complete");
  }
  const tokens = provider.savedTokensValue;
  return {
    credentials: {
      serverUrl: options.serverUrl,
      clientInformation: provider.savedClientInformation!,
      discoveryState: provider.discoveryState(),
      tokens,
      tokenExpiresAt: tokenExpiresAt(tokens),
    },
  };
}

export function validateMcpOAuthCallbackIssuer(
  discoveryState: McpOAuthDiscoveryState | undefined,
  iss: string | undefined,
): void {
  validateAuthorizationResponseIssuer({
    iss,
    expectedIssuer: issuerForDiscovery(discoveryState),
    issParameterSupported:
      discoveryState?.authorizationServerMetadata
        ?.authorization_response_iss_parameter_supported === true,
  });
}

export function tokenExpiresAt(tokens: OAuthTokens): number | undefined {
  const expiresIn = Number(tokens.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return undefined;
  return Date.now() + expiresIn * 1_000;
}

export async function saveMcpOAuthCredentials(options: {
  key: string;
  scope: "user" | "org";
  scopeId: string;
  credentials: McpOAuthCredentialBundle;
}): Promise<void> {
  const serverUrl = checkedRemoteUrl(
    options.credentials.serverUrl,
    "server",
  ).toString();
  const credentials = { ...options.credentials, serverUrl };
  if (credentials.discoveryState) {
    validateDiscoveryUrls(credentials.discoveryState);
  }
  await saveOAuthCredential(
    credentialIdentity({
      ...options,
      serverUrl,
    }),
    credentials,
    { legacyAccountKey: true },
  );
}

export async function readMcpOAuthCredentials(options: {
  key: string;
  scope: "user" | "org";
  scopeId: string;
  serverUrl?: string;
}): Promise<McpOAuthCredentialBundle | null> {
  if (!options.serverUrl) return null;
  const serverUrl = canonicalServerUrl(options.serverUrl);
  const state = await getMcpOAuthConnectionState({
    ...options,
    serverUrl,
  });
  if (state.kind === "missing" || state.kind === "malformed") return null;
  const parsed = state.credential;
  if (!serverUrlsMatch(parsed.serverUrl, serverUrl)) return null;
  if (parsed.discoveryState) {
    try {
      validateDiscoveryUrls(parsed.discoveryState);
    } catch {
      return null;
    }
  }
  return { ...parsed, serverUrl };
}

export async function getMcpOAuthConnectionState(options: {
  key: string;
  scope: "user" | "org";
  scopeId: string;
  serverUrl: string;
}): Promise<OAuthCredentialState<McpOAuthCredentialBundle>> {
  const serverUrl = canonicalServerUrl(options.serverUrl);
  return readOAuthCredentialState<McpOAuthCredentialBundle>(
    credentialIdentity({ ...options, serverUrl }),
    {
      allowLegacy: true,
      legacyAccountKey: true,
      validateCredential: (credential) =>
        serverUrlsMatch(credential.serverUrl, serverUrl),
    },
  );
}

export async function deleteMcpOAuthCredentials(options: {
  key: string;
  scope: "user" | "org";
  scopeId: string;
  serverUrl?: string;
}): Promise<boolean> {
  if (!options.serverUrl) return false;
  const serverUrl = canonicalServerUrl(options.serverUrl);
  const identity = credentialIdentity({
    ...options,
    serverUrl,
  });
  const result = await revokeOAuthCredential(identity, {
    allowLegacy: true,
    legacyAccountKey: true,
    validateCredential: (credential: McpOAuthCredentialBundle) =>
      serverUrlsMatch(credential.serverUrl, serverUrl),
  });
  return result.local === "deleted";
}

export async function revokeMcpOAuthCredentials(options: {
  key: string;
  scope: "user" | "org";
  scopeId: string;
  serverUrl: string;
}): Promise<OAuthRevocationResult> {
  const serverUrl = canonicalServerUrl(options.serverUrl);
  const identity = credentialIdentity({ ...options, serverUrl });
  return revokeOAuthCredential<McpOAuthCredentialBundle>(identity, {
    allowLegacy: true,
    legacyAccountKey: true,
    validateCredential: (credential) =>
      serverUrlsMatch(credential.serverUrl, serverUrl),
    revoke: async ({ credential }) => {
      const endpoint = (
        credential.discoveryState?.authorizationServerMetadata as
          | (AuthorizationServerMetadata & { revocation_endpoint?: string })
          | undefined
      )?.revocation_endpoint;
      if (!endpoint) return "unsupported";
      const token =
        credential.tokens.refresh_token ?? credential.tokens.access_token;
      const body = new URLSearchParams({
        token,
        token_type_hint: credential.tokens.refresh_token
          ? "refresh_token"
          : "access_token",
        client_id: credential.clientInformation.client_id,
      });
      const response = await guardedRevocationFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("MCP OAuth revocation failed.");
      }
      await response.body?.cancel().catch(() => undefined);
      return "succeeded";
    },
  });
}

/**
 * Resolve an access token for the MCP manager. Refreshing happens only when a
 * token is near expiry, so ordinary manager reconfiguration does not perform
 * a network request for every connector.
 */
export async function getMcpOAuthAccessToken(options: {
  key: string;
  scope: "user" | "org";
  scopeId: string;
  serverUrl: string;
}): Promise<string | null> {
  const validation = validateRemoteUrl(options.serverUrl);
  if (!validation.ok || !validation.url) return null;
  const serverUrl = validation.url.toString();
  const result = await resolveOAuthCredentialAccess<McpOAuthCredentialBundle>(
    credentialIdentity({ ...options, serverUrl }),
    {
      allowLegacy: true,
      legacyAccountKey: true,
      validateCredential: (credential) =>
        serverUrlsMatch(credential.serverUrl, serverUrl),
      expirySkewMs: TOKEN_EXPIRY_SKEW_MS,
      refresh: async ({ credential: credentials }) => {
        const refreshToken = credentials.tokens.refresh_token;
        const discovery = credentials.discoveryState;
        if (!refreshToken || !discovery?.authorizationServerUrl) {
          throw new Error("MCP OAuth refresh is unavailable.");
        }
        const expectedIssuer = issuerForDiscovery(discovery);
        if (
          !expectedIssuer ||
          credentials.clientInformation.issuer !== expectedIssuer ||
          credentials.tokens.issuer !== expectedIssuer
        ) {
          throw new Error("MCP OAuth refresh issuer binding is invalid.");
        }
        const resource = discovery.resourceMetadata?.resource
          ? checkedRemoteUrl(discovery.resourceMetadata.resource, "resource")
          : undefined;
        const authorizationServerUrl = checkedRemoteUrl(
          discovery.authorizationServerUrl,
          "authorization server",
        );
        const refreshed = await refreshAuthorization(authorizationServerUrl, {
          metadata: discovery.authorizationServerMetadata,
          clientInformation: credentials.clientInformation,
          refreshToken,
          resource,
          fetchFn: guardedOAuthFetch(),
        });
        const nextTokens: StoredOAuthTokens = {
          ...credentials.tokens,
          ...refreshed,
          issuer: expectedIssuer,
          ...(refreshed.refresh_token
            ? { refresh_token: refreshed.refresh_token }
            : credentials.tokens.refresh_token
              ? { refresh_token: credentials.tokens.refresh_token }
              : {}),
        };
        const next: McpOAuthCredentialBundle = {
          ...credentials,
          tokens: nextTokens,
          tokenExpiresAt: tokenExpiresAt(nextTokens),
        };
        return next;
      },
    },
  );
  return result.accessToken;
}

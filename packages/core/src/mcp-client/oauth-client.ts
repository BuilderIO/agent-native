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
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthProtectedResourceMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import {
  deleteOAuthTokens,
  getOAuthTokens,
  saveOAuthTokens,
} from "../oauth-tokens/store.js";

const TOKEN_EXPIRY_SKEW_MS = 60_000;

function credentialOwner(options: { scope: "user" | "org"; scopeId: string }) {
  return `${options.scope}:${options.scopeId}`;
}

export interface McpOAuthDiscoveryState {
  authorizationServerUrl: string;
  authorizationServerMetadata?: AuthorizationServerMetadata;
  resourceMetadata?: OAuthProtectedResourceMetadata;
  resourceMetadataUrl?: string;
}

export interface McpOAuthCredentialBundle {
  serverUrl: string;
  clientInformation: OAuthClientInformationMixed;
  discoveryState?: McpOAuthDiscoveryState;
  tokens: OAuthTokens;
  tokenExpiresAt?: number;
}

export interface McpOAuthStartResult {
  authorizationUrl: URL;
  codeVerifier: string;
  state: string;
  clientInformation: OAuthClientInformationMixed;
  discoveryState?: McpOAuthDiscoveryState;
}

export interface McpOAuthCallbackResult {
  credentials: McpOAuthCredentialBundle;
}

export interface McpOAuthProviderOptions {
  serverUrl: string;
  redirectUrl: string;
  state: string;
  clientInformation?: OAuthClientInformationMixed;
  codeVerifier?: string;
  discoveryState?: McpOAuthDiscoveryState;
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
  private clientInfo?: OAuthClientInformationMixed;
  private savedTokens?: OAuthTokens;
  private savedCodeVerifier?: string;
  private savedDiscovery?: McpOAuthDiscoveryState;
  private authorizationUrl?: URL;

  constructor(options: McpOAuthProviderOptions) {
    this.redirectUrlValue = options.redirectUrl;
    this.stateValue = options.state;
    this.clientInfo = options.clientInformation;
    this.savedCodeVerifier = options.codeVerifier;
    this.savedDiscovery = options.discoveryState;
    this.metadata = {
      redirect_uris: [options.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
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

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.clientInfo;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.clientInfo = info;
  }

  tokens(): OAuthTokens | undefined {
    return this.savedTokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.savedTokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
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

  get savedClientInformation(): OAuthClientInformationMixed | undefined {
    return this.clientInfo;
  }
}

export async function startMcpOAuthAuthorization(
  options: McpOAuthProviderOptions & { scope?: string },
): Promise<McpOAuthStartResult> {
  const provider = new McpOAuthClientProvider(options);
  const result = await auth(provider, {
    serverUrl: options.serverUrl,
    scope: options.scope,
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
  options: McpOAuthProviderOptions & { authorizationCode: string },
): Promise<McpOAuthCallbackResult> {
  const provider = new McpOAuthClientProvider(options);
  const result = await auth(provider, {
    serverUrl: options.serverUrl,
    authorizationCode: options.authorizationCode,
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
  await saveOAuthTokens(
    "mcp",
    options.key,
    options.credentials as unknown as Record<string, unknown>,
    `${options.scope}:${options.scopeId}`,
  );
}

export async function readMcpOAuthCredentials(options: {
  key: string;
  scope: "user" | "org";
  scopeId: string;
}): Promise<McpOAuthCredentialBundle | null> {
  const stored = await getOAuthTokens(
    "mcp",
    options.key,
    credentialOwner(options),
  );
  if (!stored) return null;
  const parsed = stored as Partial<McpOAuthCredentialBundle>;
  if (
    typeof parsed.serverUrl !== "string" ||
    !parsed.clientInformation ||
    !parsed.tokens ||
    typeof parsed.tokens.access_token !== "string"
  ) {
    return null;
  }
  return parsed as McpOAuthCredentialBundle;
}

export async function deleteMcpOAuthCredentials(options: {
  key: string;
  scope: "user" | "org";
  scopeId: string;
}): Promise<boolean> {
  return (
    (await deleteOAuthTokens("mcp", options.key, credentialOwner(options))) > 0
  );
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
  const credentials = await readMcpOAuthCredentials(options);
  if (!credentials || credentials.serverUrl !== options.serverUrl) return null;

  const accessToken = credentials.tokens.access_token;
  if (
    typeof credentials.tokenExpiresAt !== "number" ||
    credentials.tokenExpiresAt - Date.now() > TOKEN_EXPIRY_SKEW_MS
  ) {
    return accessToken;
  }

  const refreshToken = credentials.tokens.refresh_token;
  const discovery = credentials.discoveryState;
  if (!refreshToken || !discovery?.authorizationServerUrl) {
    return accessToken;
  }

  try {
    const resource = discovery.resourceMetadata?.resource
      ? new URL(discovery.resourceMetadata.resource)
      : undefined;
    const refreshed = await refreshAuthorization(
      discovery.authorizationServerUrl,
      {
        metadata: discovery.authorizationServerMetadata,
        clientInformation: credentials.clientInformation,
        refreshToken,
        resource,
      },
    );
    const next: McpOAuthCredentialBundle = {
      ...credentials,
      tokens: refreshed,
      tokenExpiresAt: tokenExpiresAt(refreshed),
    };
    await saveMcpOAuthCredentials({
      ...options,
      credentials: next,
    });
    return refreshed.access_token;
  } catch {
    // Keep the old token so the MCP request can return the provider's normal
    // auth error. A single expired connector must not remove every server from
    // the process-wide manager during a config refresh.
    return accessToken;
  }
}

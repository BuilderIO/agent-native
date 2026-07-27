import { createHash, createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";

export type InjectedFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type OAuthMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  resource: string;
};

export type PkcePair = { verifier: string; challenge: string; method: "S256" };

export type HostedHarnessEvidence = {
  assertionId: string;
  status: "passed" | "failed";
  timestamp: string;
  origins: string[];
  taskIdHash?: string;
  resultHash?: string;
  proofDigest?: string;
  provenance?: string;
  httpStatus?: number;
  publicResource?: string;
  publicIssuer?: string;
};

/**
 * Minimal browser seam. Implementations retain the browser's HTTP-only cookie;
 * callers never handle it directly. `postJson` is deliberately same-origin
 * relative-path only, so credentials cannot be sent to another host.
 */
export type HostedQaBrowserAdapter = {
  origin: string;
  postJson: (
    path: "/_agent-native/auth/register" | "/_agent-native/auth/login",
    body: { email: string; password: string; callbackURL?: string },
  ) => Promise<{ status: number }>;
  getJson: (path: "/_agent-native/auth/session") => Promise<unknown>;
  /** Opens the authorization URL in the already authenticated browser and approves consent. */
  authorize?: (authorizationUrl: string) => Promise<void>;
  /** Uses that same authenticated browser to prove a resource is rejected. */
  authorizeExpectRejected?: (
    authorizationUrl: string,
  ) => Promise<{ status: number }>;
};

export type SyntheticQaIdentity = {
  email: string;
  passwordEntropyBits: 256;
  /** The password stays in this closure and is never included in JSON output. */
  withPassword: <T>(use: (password: string) => Promise<T> | T) => Promise<T>;
};

export type LoopbackCallback = {
  redirectUri: string;
  waitForCallback: () => Promise<string>;
  close: () => Promise<void>;
};

export type OAuthCodeFlowResult = {
  /** Transient runtime value: callers must not serialize it. */
  accessToken: string;
  evidence: HostedHarnessEvidence[];
};

export type ForeignDomainSentinel = {
  /** Transient controller-owned value, never evidence or a production token. */
  token: string;
  proofDigest: string;
  signingAuthorityHash: string;
};

function stableAcceptanceOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/(?:^|[-.])acceptance(?:[-.]|$)/i.test(url.hostname) ||
    /(?:^|[-.])(?:prod|production)(?:[-.]|$)/i.test(url.hostname)
  ) {
    throw new Error("expected a stable non-production acceptance origin");
  }
  return url.origin;
}

function trustedUrl(value: string, origin: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== origin) {
    throw new Error(
      "OAuth endpoint must remain on the configured acceptance origin",
    );
  }
  return url;
}

function trustedMcpUrl(value: string): string {
  const url = new URL(value);
  stableAcceptanceOrigin(url.origin);
  if (!url.pathname || url.search || url.hash || url.username || url.password) {
    throw new Error(
      "MCP endpoint must be a clean URL on the acceptance origin",
    );
  }
  return url.toString();
}

function validateRedirectUri(value: string): string {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    throw new Error(
      "redirect URI must use HTTPS or an exact loopback HTTP URI",
    );
  }
  return url.toString();
}

function hashTaskId(taskId: string): string {
  return `sha256:${createHash("sha256").update(taskId).digest("hex").slice(0, 16)}`;
}

function redactedHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== "https:")
    throw new Error("expected an exact HTTPS origin");
  return url.origin;
}

function cleanHttpsResource(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("expected a clean HTTPS resource URL");
  return url.toString();
}

function leaseHash(leaseId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/i.test(leaseId))
    throw new Error("lease ID must be a stable safe identifier");
  return createHash("sha256").update(leaseId).digest("hex").slice(0, 20);
}

/**
 * Creates a lease-bound disposable account without making its password a
 * serializable field. The adapter receives it only while issuing same-origin
 * requests from the trusted runner's browser context.
 */
export function createSyntheticQaIdentity(
  leaseId: string,
  domain = "acceptance.invalid",
): SyntheticQaIdentity {
  const suffix = leaseHash(leaseId);
  if (!/^[a-z0-9.-]+$/i.test(domain) || !domain.includes("."))
    throw new Error("synthetic QA email domain is invalid");
  const password = randomBytes(32).toString("base64url");
  return {
    email: `trusted-acceptance+qa-${suffix}@${domain.toLowerCase()}`,
    passwordEntropyBits: 256,
    withPassword: async (use) => use(password),
  };
}

function assertSameAcceptanceBrowser(
  browser: HostedQaBrowserAdapter,
  appOrigin: string,
): string {
  const origin = stableAcceptanceOrigin(appOrigin);
  if (exactOrigin(browser.origin) !== origin)
    throw new Error(
      "hosted QA browser origin does not match acceptance origin",
    );
  return origin;
}

function sessionEmail(session: unknown): string | undefined {
  if (!session || typeof session !== "object") return undefined;
  const value = session as { email?: unknown; user?: { email?: unknown } };
  return typeof value.email === "string"
    ? value.email
    : typeof value.user?.email === "string"
      ? value.user.email
      : undefined;
}

/** Establish and verify a real browser session through the existing hosted-QA routes. */
export async function bootstrapHostedQaSession(input: {
  browser: HostedQaBrowserAdapter;
  appOrigin: string;
  identity: SyntheticQaIdentity;
}): Promise<HostedHarnessEvidence> {
  const origin = assertSameAcceptanceBrowser(input.browser, input.appOrigin);
  await input.identity.withPassword(async (password) => {
    const registered = await input.browser.postJson(
      "/_agent-native/auth/register",
      { email: input.identity.email, password, callbackURL: "/" },
    );
    if (registered.status !== 200 && registered.status !== 409)
      throw new Error(
        `same-origin registration failed with HTTP ${registered.status}`,
      );
    const loggedIn = await input.browser.postJson("/_agent-native/auth/login", {
      email: input.identity.email,
      password,
    });
    if (loggedIn.status !== 200)
      throw new Error(`same-origin login failed with HTTP ${loggedIn.status}`);
  });
  if (
    sessionEmail(await input.browser.getJson("/_agent-native/auth/session")) !==
    input.identity.email
  ) {
    throw new Error(
      "same-origin session did not report the exact synthetic email",
    );
  }
  return {
    assertionId: "hosted-qa-synthetic-session",
    status: "passed",
    timestamp: new Date().toISOString(),
    origins: [origin],
    provenance:
      "lease-bound-synthetic-email; password-retained-in-runner-memory",
  };
}

function requestJson(
  init: RequestInit,
  body?: Record<string, unknown>,
): RequestInit {
  return {
    ...init,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

async function requireOk(response: Response): Promise<Response> {
  if (!response.ok)
    throw new Error(`unexpected HTTP status ${response.status}`);
  return response;
}

async function require4xx(
  response: Response,
  assertion: string,
): Promise<number> {
  if (response.status < 400 || response.status >= 500)
    throw new Error(`${assertion} expected 4xx, received ${response.status}`);
  return response.status;
}

export function createS256Pkce(verifier?: string): PkcePair {
  const value = verifier ?? randomBytes(48).toString("base64url");
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(value)) {
    throw new Error("PKCE verifier must be 43-128 RFC 7636 characters");
  }
  return {
    verifier: value,
    challenge: createHash("sha256").update(value).digest("base64url"),
    method: "S256",
  };
}

export async function discoverOAuth(
  fetchFn: InjectedFetch,
  appOrigin: string,
): Promise<OAuthMetadata> {
  const origin = stableAcceptanceOrigin(appOrigin);
  const protectedResourceResponse = await requireOk(
    await fetchFn(`${origin}/.well-known/oauth-protected-resource`, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    }),
  );
  const protectedResource = (await protectedResourceResponse.json()) as {
    authorization_servers?: unknown;
    resource?: unknown;
  };
  const authorizationServer = Array.isArray(
    protectedResource.authorization_servers,
  )
    ? protectedResource.authorization_servers.find(
        (value): value is string => typeof value === "string",
      )
    : undefined;
  if (!authorizationServer) {
    throw new Error(
      "protected resource metadata omitted authorization_servers",
    );
  }
  if (typeof protectedResource.resource !== "string")
    throw new Error("protected resource metadata omitted resource");
  const resource = trustedUrl(protectedResource.resource, origin).toString();
  const authorizationOrigin = trustedUrl(authorizationServer, origin).origin;
  const response = await requireOk(
    await fetchFn(
      `${authorizationOrigin}/.well-known/oauth-authorization-server`,
      {
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      },
    ),
  );
  const metadata = (await response.json()) as Omit<OAuthMetadata, "resource">;
  trustedUrl(metadata.authorization_endpoint, authorizationOrigin);
  trustedUrl(metadata.token_endpoint, authorizationOrigin);
  if (metadata.registration_endpoint)
    trustedUrl(metadata.registration_endpoint, authorizationOrigin);
  return { ...metadata, resource };
}

/** Read only public OAuth identity metadata for a distinct HTTPS resource. */
export async function discoverPublicOAuthIdentity(
  fetchFn: InjectedFetch,
  appOrigin: string,
): Promise<{ resource: string; issuer: string }> {
  const origin = new URL(appOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== appOrigin ||
    origin.username ||
    origin.password
  ) {
    throw new Error("public OAuth identity requires an exact HTTPS origin");
  }
  const response = await requireOk(
    await fetchFn(`${origin.origin}/.well-known/oauth-protected-resource`, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    }),
  );
  const metadata = (await response.json()) as {
    authorization_servers?: unknown;
    resource?: unknown;
  };
  const issuer = Array.isArray(metadata.authorization_servers)
    ? metadata.authorization_servers.find(
        (value): value is string => typeof value === "string",
      )
    : undefined;
  if (typeof metadata.resource !== "string" || !issuer)
    throw new Error("public OAuth identity metadata is incomplete");
  const resourceUrl = new URL(metadata.resource);
  const issuerUrl = new URL(issuer);
  if (resourceUrl.protocol !== "https:" || issuerUrl.protocol !== "https:")
    throw new Error("public OAuth identity metadata must use HTTPS");
  return { resource: resourceUrl.toString(), issuer: issuerUrl.origin };
}

export function buildAuthorizationUrl(input: {
  metadata: OAuthMetadata;
  appOrigin: string;
  clientId: string;
  redirectUri: string;
  state: string;
  pkce: PkcePair;
}): string {
  const origin = stableAcceptanceOrigin(input.appOrigin);
  const endpoint = trustedUrl(input.metadata.authorization_endpoint, origin);
  const redirectUri = validateRedirectUri(input.redirectUri);
  endpoint.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: redirectUri,
    state: input.state,
    code_challenge: input.pkce.challenge,
    code_challenge_method: "S256",
    resource: trustedUrl(input.metadata.resource, origin).toString(),
    scope: "mcp:read mcp:write mcp:apps",
  }).toString();
  return endpoint.toString();
}

export async function registerDynamicClient(input: {
  fetchFn: InjectedFetch;
  metadata: OAuthMetadata;
  appOrigin: string;
  redirectUri: string;
}): Promise<{ clientId: string }> {
  const origin = stableAcceptanceOrigin(input.appOrigin);
  if (!input.metadata.registration_endpoint) {
    throw new Error("OAuth server does not advertise dynamic registration");
  }
  const endpoint = trustedUrl(input.metadata.registration_endpoint, origin);
  const redirectUri = validateRedirectUri(input.redirectUri);
  const response = await requireOk(
    await input.fetchFn(
      endpoint.toString(),
      requestJson(
        {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        },
        {
          client_name: "agent-native-trusted-acceptance",
          redirect_uris: [redirectUri],
        },
      ),
    ),
  );
  const result = (await response.json()) as { client_id?: unknown };
  if (typeof result.client_id !== "string" || !result.client_id) {
    throw new Error("dynamic registration response omitted client_id");
  }
  return { clientId: result.client_id };
}

export async function exchangeAuthorizationCode(input: {
  fetchFn: InjectedFetch;
  metadata: OAuthMetadata;
  appOrigin: string;
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<{ accessToken: string }> {
  const endpoint = trustedUrl(
    input.metadata.token_endpoint,
    stableAcceptanceOrigin(input.appOrigin),
  );
  const redirectUri = validateRedirectUri(input.redirectUri);
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    redirect_uri: redirectUri,
    code: input.code,
    code_verifier: input.verifier,
    resource: trustedUrl(
      input.metadata.resource,
      stableAcceptanceOrigin(input.appOrigin),
    ).toString(),
  });
  const response = await requireOk(
    await input.fetchFn(endpoint.toString(), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }),
  );
  const result = (await response.json()) as { access_token?: unknown };
  if (typeof result.access_token !== "string" || !result.access_token) {
    throw new Error("token response omitted access_token");
  }
  return { accessToken: result.access_token };
}

/**
 * Injected callback implementations make browser tests deterministic. This
 * local listener is the production-shaped runner option and binds loopback
 * only; it never logs query strings or authorization codes.
 */
export async function startLoopbackCallbackListener(
  options: {
    host?: "127.0.0.1" | "::1";
    port?: number;
    path?: string;
    timeoutMs?: number;
  } = {},
): Promise<LoopbackCallback> {
  const host = options.host ?? "127.0.0.1";
  const path = options.path ?? "/oauth/callback";
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000)
    throw new Error("loopback callback timeout must be 1-120000ms");
  if (!path.startsWith("/") || path.includes("?"))
    throw new Error("loopback callback path must be an absolute clean path");
  let resolveCallback: ((value: string) => void) | undefined;
  let rejectCallback: ((reason: Error) => void) | undefined;
  const received = new Promise<string>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  let callbackOrigin = "";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${host}`);
    if (request.method !== "GET" || requestUrl.pathname !== path) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.statusCode = 204;
    response.end();
    if (timeout) clearTimeout(timeout);
    resolveCallback?.(`${callbackOrigin}${request.url}`);
  });
  const bound = await new Promise<{ port: number }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("loopback callback listener did not bind a TCP port"));
        return;
      }
      resolve({ port: address.port });
    });
  });
  callbackOrigin = `http://${host === "::1" ? `[${host}]` : host}:${bound.port}`;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const closeServer = () => {
    closePromise ??= new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
    return closePromise;
  };
  timeout = setTimeout(() => {
    closed = true;
    rejectCallback?.(new Error("loopback callback listener timed out"));
    void closeServer().catch(() => undefined);
  }, timeoutMs);
  return {
    redirectUri: `${callbackOrigin}${path}`,
    waitForCallback: () => received,
    close: async () => {
      if (!closed) {
        closed = true;
        if (timeout) clearTimeout(timeout);
        rejectCallback?.(
          new Error("loopback callback listener closed before callback"),
        );
      }
      await closeServer();
    },
  };
}

export function authorizationCodeFromCallback(input: {
  callbackUrl: string;
  redirectUri: string;
  state: string;
}): string {
  const callback = new URL(input.callbackUrl);
  const redirect = new URL(validateRedirectUri(input.redirectUri));
  if (
    callback.protocol !== redirect.protocol ||
    callback.hostname !== redirect.hostname ||
    callback.port !== redirect.port ||
    callback.pathname !== redirect.pathname ||
    callback.searchParams.get("state") !== input.state
  ) {
    throw new Error(
      "OAuth callback did not match the exact redirect URI and state",
    );
  }
  const code = callback.searchParams.get("code");
  if (!code || callback.searchParams.has("error"))
    throw new Error("OAuth callback did not include an authorization code");
  return code;
}

/** Complete discovery, dynamic registration, consent, exact callback validation, and S256 exchange. */
export async function runHostedOAuthCodeFlow(input: {
  fetchFn: InjectedFetch;
  appOrigin: string;
  browser: HostedQaBrowserAdapter;
  callback: LoopbackCallback;
  state?: string;
  pkce?: PkcePair;
  nonAllowlistedResource?: string;
  now?: () => string;
}): Promise<OAuthCodeFlowResult> {
  const origin = assertSameAcceptanceBrowser(input.browser, input.appOrigin);
  if (!input.browser.authorize)
    throw new Error(
      "hosted QA browser adapter must provide OAuth consent orchestration",
    );
  const metadata = await discoverOAuth(input.fetchFn, origin);
  const registration = await registerDynamicClient({
    fetchFn: input.fetchFn,
    metadata,
    appOrigin: origin,
    redirectUri: input.callback.redirectUri,
  });
  const state = input.state ?? randomBytes(32).toString("base64url");
  if (state.length < 32) throw new Error("OAuth state must be high entropy");
  const pkce = input.pkce ?? createS256Pkce();
  const authorizationUrl = buildAuthorizationUrl({
    metadata,
    appOrigin: origin,
    clientId: registration.clientId,
    redirectUri: input.callback.redirectUri,
    state,
    pkce,
  });
  const callbackPromise = input.callback.waitForCallback();
  const [, callbackUrl] = await Promise.all([
    input.browser.authorize(authorizationUrl),
    callbackPromise,
  ]);
  const code = authorizationCodeFromCallback({
    callbackUrl,
    redirectUri: input.callback.redirectUri,
    state,
  });
  const token = await exchangeAuthorizationCode({
    fetchFn: input.fetchFn,
    metadata,
    appOrigin: origin,
    clientId: registration.clientId,
    redirectUri: input.callback.redirectUri,
    code,
    verifier: pkce.verifier,
  });
  const negativeEvidence = input.nonAllowlistedResource
    ? await runRequiredOAuthNegativeProbes({
        fetchFn: input.fetchFn,
        browser: input.browser,
        metadata,
        appOrigin: origin,
        clientId: registration.clientId,
        redirectUri: input.callback.redirectUri,
        code,
        verifier: pkce.verifier,
        authorizationUrl,
        nonAllowlistedResource: input.nonAllowlistedResource,
        now: input.now,
      })
    : [];
  return {
    accessToken: token.accessToken,
    evidence: [
      {
        assertionId: "hosted-oauth-dynamic-registration-s256-pkce",
        status: "passed",
        timestamp: (input.now ?? (() => new Date().toISOString()))(),
        origins: [origin],
        proofDigest: redactedHash(token.accessToken),
        publicResource: metadata.resource,
        publicIssuer: new URL(metadata.authorization_endpoint).origin,
        provenance:
          "real-oauth-code-flow; exact-state; loopback-callback; token-redacted",
      },
      ...negativeEvidence,
    ],
  };
}

/**
 * Real negative OAuth probes. Inputs stay transient: evidence records only the
 * fact that the authority rejected a replay and non-allowlisted audience.
 */
export async function runRequiredOAuthNegativeProbes(input: {
  fetchFn: InjectedFetch;
  browser: HostedQaBrowserAdapter;
  metadata: OAuthMetadata;
  appOrigin: string;
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
  authorizationUrl: string;
  nonAllowlistedResource: string;
  now?: () => string;
}): Promise<HostedHarnessEvidence[]> {
  const origin = assertSameAcceptanceBrowser(input.browser, input.appOrigin);
  const endpoint = trustedUrl(input.metadata.token_endpoint, origin);
  const unauthenticated = new URL(input.authorizationUrl);
  unauthenticated.searchParams.set("prompt", "none");
  const unauthenticatedResponse = await input.fetchFn(
    unauthenticated.toString(),
    { redirect: "manual", signal: AbortSignal.timeout(10_000) },
  );
  const unauthenticatedLocation =
    unauthenticatedResponse.headers.get("location");
  const unauthenticatedRedirect = unauthenticatedLocation
    ? new URL(unauthenticatedLocation, unauthenticated.toString())
    : undefined;
  if (
    !unauthenticatedRedirect ||
    ![302, 303].includes(unauthenticatedResponse.status) ||
    unauthenticatedRedirect.searchParams.get("error") !== "login_required" ||
    unauthenticatedRedirect.searchParams.has("code")
  ) {
    throw new Error("unauthenticated OAuth authorization did not fail closed");
  }
  const replay = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    redirect_uri: validateRedirectUri(input.redirectUri),
    code: input.code,
    code_verifier: input.verifier,
    resource: trustedUrl(input.metadata.resource, origin).toString(),
  });
  const replayStatus = await require4xx(
    await input.fetchFn(endpoint.toString(), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: replay.toString(),
    }),
    "authorization-code replay",
  );
  if (!input.browser.authorizeExpectRejected)
    throw new Error(
      "browser adapter cannot prove wrong-audience authorization rejection",
    );
  const forbidden = cleanHttpsResource(input.nonAllowlistedResource);
  const authorization = trustedUrl(
    input.metadata.authorization_endpoint,
    origin,
  );
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: validateRedirectUri(input.redirectUri),
    state: randomBytes(32).toString("base64url"),
    code_challenge: createS256Pkce().challenge,
    code_challenge_method: "S256",
    resource: forbidden,
    scope: "mcp:read",
  }).toString();
  const rejected = await input.browser.authorizeExpectRejected(
    authorization.toString(),
  );
  if (rejected.status < 400 || rejected.status >= 500)
    throw new Error(
      `wrong-audience authorization expected 4xx, received ${rejected.status}`,
    );
  const timestamp = (input.now ?? (() => new Date().toISOString()))();
  return [
    {
      assertionId: "unauthenticated-oauth-code-rejected",
      status: "passed",
      timestamp,
      origins: [origin],
      httpStatus: unauthenticatedResponse.status,
      provenance: "prompt-none; login-required; no-code; status-only",
    },
    {
      assertionId: "oauth-authorization-code-replay-rejected",
      status: "passed",
      timestamp,
      origins: [origin],
      httpStatus: replayStatus,
      provenance: "same-code-second-exchange; status-only",
    },
    {
      assertionId: "oauth-wrong-audience-rejected",
      status: "passed",
      timestamp,
      origins: [origin, new URL(forbidden).origin],
      httpStatus: rejected.status,
      provenance:
        "authenticated-authorization-request; non-allowlisted-resource; status-only",
    },
  ];
}

export class HostedMcpClient {
  private readonly mcpUrl: string;

  constructor(
    private readonly fetchFn: InjectedFetch,
    mcpUrl: string,
    private readonly accessToken: string,
  ) {
    this.mcpUrl = trustedMcpUrl(mcpUrl);
  }

  get origin(): string {
    return new URL(this.mcpUrl).origin;
  }

  async listApps(): Promise<unknown> {
    return this.callTool("list_apps", {});
  }

  async askApp(app: string, message: string): Promise<unknown> {
    return this.callTool("ask_app", { app, message });
  }

  async askAppStatus(app: string, taskId: string): Promise<unknown> {
    return this.callTool("ask_app_status", { app, taskId });
  }

  async callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await requireOk(
      await this.fetchFn(
        this.mcpUrl,
        requestJson(
          {
            method: "POST",
            headers: { Authorization: `Bearer ${this.accessToken}` },
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          },
          {
            jsonrpc: "2.0",
            id: "trusted-acceptance",
            method: "tools/call",
            params: { name, arguments: arguments_ },
          },
        ),
      ),
    );
    const body = (await response.json()) as {
      error?: unknown;
      result?: unknown;
    };
    if (body.error || !("result" in body))
      throw new Error("MCP JSON-RPC call failed");
    return body.result;
  }
}

function taskIdFrom(value: unknown): string {
  const result = value as {
    taskId?: unknown;
    structuredContent?: { taskId?: unknown };
  };
  const taskId = result?.taskId ?? result?.structuredContent?.taskId;
  if (typeof taskId !== "string" || !taskId)
    throw new Error("ask_app did not return a task ID");
  return taskId;
}

function isComplete(value: unknown): boolean {
  const result = value as {
    status?: unknown;
    structuredContent?: { status?: unknown };
  };
  const status = result?.status ?? result?.structuredContent?.status;
  return status === "completed" || status === "complete";
}

function hasApp(value: unknown, appId: string): boolean {
  const result = value as {
    apps?: unknown;
    structuredContent?: { apps?: unknown };
  };
  const apps = result?.apps ?? result?.structuredContent?.apps;
  return (
    Array.isArray(apps) &&
    apps.some(
      (app) =>
        typeof app === "object" &&
        app !== null &&
        (app as { id?: unknown }).id === appId,
    )
  );
}

function containsExpectedResult(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value.includes(expected);
  if (Array.isArray(value))
    return value.some((entry) => containsExpectedResult(entry, expected));
  if (value && typeof value === "object")
    return Object.values(value).some((entry) =>
      containsExpectedResult(entry, expected),
    );
  return false;
}

/** A trusted controller callback changes fixture state; it is never an HTTP input. */
export async function runWithdrawalScenario(input: {
  client: HostedMcpClient;
  targetApp: string;
  message: string;
  expectedResult: string;
  controller: { withdrawDirectoryMember: () => Promise<void> | void };
  now?: () => string;
  maxStatusPolls?: number;
  wait?: () => Promise<void> | void;
}): Promise<HostedHarnessEvidence[]> {
  const timestamp = (input.now ?? (() => new Date().toISOString()))();
  if (!hasApp(await input.client.listApps(), input.targetApp)) {
    throw new Error(
      "stable directory discovery did not include the target app",
    );
  }
  const taskId = taskIdFrom(
    await input.client.askApp(input.targetApp, input.message),
  );
  await input.controller.withdrawDirectoryMember();
  if (hasApp(await input.client.listApps(), input.targetApp))
    throw new Error("directory withdrawal did not remove the target app");
  const maxStatusPolls = input.maxStatusPolls ?? 3;
  let status: unknown;
  for (let attempt = 0; attempt < maxStatusPolls; attempt++) {
    status = await input.client.askAppStatus(input.targetApp, taskId);
    if (isComplete(status)) break;
    if (attempt < maxStatusPolls - 1) await input.wait?.();
  }
  if (!isComplete(status))
    throw new Error("same task did not complete after withdrawal");
  if (!containsExpectedResult(status, input.expectedResult))
    throw new Error(
      "completed task did not contain the expected synthetic result",
    );
  return [
    {
      assertionId: "directory-withdrawal-same-task-status",
      status: "passed",
      timestamp,
      origins: [input.client.origin],
      taskIdHash: hashTaskId(taskId),
      resultHash: redactedHash(input.expectedResult),
    },
  ];
}

/** Assert a failed trust probe without reading or retaining its response body. */
export async function expectUnauthorized(
  fetchFn: InjectedFetch,
  url: string,
  init?: RequestInit,
): Promise<{ status: 401 }> {
  const response = await fetchFn(url, {
    ...init,
    redirect: "manual",
    signal: init?.signal ?? AbortSignal.timeout(10_000),
  });
  if (response.status !== 401)
    throw new Error(`expected 401, received ${response.status}`);
  return { status: 401 };
}

/** Assert a fail-closed 4xx after runtime teardown without reading its body. */
export async function expectRejected4xx(
  fetchFn: InjectedFetch,
  url: string,
  init?: RequestInit,
): Promise<{ status: number }> {
  const response = await fetchFn(url, {
    ...init,
    redirect: "manual",
    signal: init?.signal ?? AbortSignal.timeout(10_000),
  });
  if (response.status < 400 || response.status >= 500)
    throw new Error(`expected fail-closed 4xx, received ${response.status}`);
  return { status: response.status };
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Create a disposable controller-owned wrong-domain JWT. It is expressly not
 * a production token: its independently generated signing key never leaves
 * runner memory and no production credential is requested or represented.
 */
export function createForeignDomainSentinel(input: {
  productionResource: string;
  acceptanceResource: string;
  signingKey?: Uint8Array;
  now?: () => number;
}): ForeignDomainSentinel {
  const production = cleanHttpsResource(input.productionResource);
  const acceptance = trustedMcpUrl(input.acceptanceResource);
  if (new URL(production).origin === new URL(acceptance).origin)
    throw new Error(
      "foreign-domain sentinel must not name the acceptance resource",
    );
  const key = input.signingKey ?? randomBytes(32);
  if (key.byteLength < 32)
    throw new Error(
      "foreign-domain sentinel requires at least 256 bits of signing entropy",
    );
  const now = Math.floor((input.now ?? (() => Date.now()))() / 1000);
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    iss: production,
    aud: production,
    iat: now,
    exp: now + 60,
    jti: randomBytes(16).toString("base64url"),
  });
  const signingInput = `${header}.${payload}`;
  const token = `${signingInput}.${createHmac("sha256", key)
    .update(signingInput)
    .digest("base64url")}`;
  return {
    token,
    proofDigest: redactedHash(token),
    signingAuthorityHash: redactedHash(Buffer.from(key).toString("base64url")),
  };
}

/**
 * Exercise only controller-owned negative trust probes. Evidence contains
 * status and provenance, never token bodies; this does not claim possession
 * of a valid production token.
 */
export async function runCryptographicIsolationProbes(input: {
  fetchFn: InjectedFetch;
  acceptanceToken: string;
  productionMcpUrl: string;
  otherAcceptanceMcpUrl: string;
  acceptanceMcpUrl: string;
  foreignDomainSentinel: ForeignDomainSentinel;
  now?: () => string;
}): Promise<HostedHarnessEvidence[]> {
  const acceptance = trustedMcpUrl(input.acceptanceMcpUrl);
  const otherAcceptance = trustedMcpUrl(input.otherAcceptanceMcpUrl);
  const production = new URL(input.productionMcpUrl);
  if (
    production.protocol !== "https:" ||
    production.origin === new URL(acceptance).origin
  )
    throw new Error("production MCP probe must be a distinct HTTPS origin");
  if (new URL(otherAcceptance).origin === new URL(acceptance).origin)
    throw new Error("other acceptance MCP probe must use a distinct resource");
  const bearer = (token: string): RequestInit => ({
    headers: { Authorization: `Bearer ${token}` },
  });
  await expectUnauthorized(
    input.fetchFn,
    production.toString(),
    bearer(input.acceptanceToken),
  );
  await expectUnauthorized(
    input.fetchFn,
    otherAcceptance,
    bearer(input.acceptanceToken),
  );
  await expectUnauthorized(
    input.fetchFn,
    acceptance,
    bearer(input.foreignDomainSentinel.token),
  );
  const timestamp = (input.now ?? (() => new Date().toISOString()))();
  return [
    {
      assertionId: "acceptance-token-rejected-by-production-resource",
      status: "passed",
      timestamp,
      origins: [new URL(acceptance).origin, production.origin],
      httpStatus: 401,
      proofDigest: redactedHash(input.acceptanceToken),
      provenance: "acceptance-token; production-rejection-status-only",
    },
    {
      assertionId: "acceptance-token-rejected-by-other-acceptance-resource",
      status: "passed",
      timestamp,
      origins: [new URL(acceptance).origin, new URL(otherAcceptance).origin],
      httpStatus: 401,
      proofDigest: redactedHash(input.acceptanceToken),
      provenance: "acceptance-token; distinct-resource-rejection-status-only",
    },
    {
      assertionId: "foreign-domain-sentinel-rejected-by-acceptance",
      status: "passed",
      timestamp,
      origins: [new URL(acceptance).origin, production.origin],
      httpStatus: 401,
      proofDigest: input.foreignDomainSentinel.proofDigest,
      provenance:
        "independently-signed-foreign-domain-sentinel; not-a-valid-production-token; signing-authority-hash=" +
        input.foreignDomainSentinel.signingAuthorityHash,
    },
  ];
}

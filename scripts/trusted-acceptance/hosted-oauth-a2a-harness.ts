import { createHash, randomBytes } from "node:crypto";

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
      { headers: { Accept: "application/json" } },
    ),
  );
  const metadata = (await response.json()) as Omit<OAuthMetadata, "resource">;
  trustedUrl(metadata.authorization_endpoint, authorizationOrigin);
  trustedUrl(metadata.token_endpoint, authorizationOrigin);
  if (metadata.registration_endpoint)
    trustedUrl(metadata.registration_endpoint, authorizationOrigin);
  return { ...metadata, resource };
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
        { method: "POST" },
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

/** A trusted controller callback changes fixture state; it is never an HTTP input. */
export async function runWithdrawalScenario(input: {
  client: HostedMcpClient;
  targetApp: string;
  message: string;
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
  const maxStatusPolls = input.maxStatusPolls ?? 3;
  let status: unknown;
  for (let attempt = 0; attempt < maxStatusPolls; attempt++) {
    status = await input.client.askAppStatus(input.targetApp, taskId);
    if (isComplete(status)) break;
    if (attempt < maxStatusPolls - 1) await input.wait?.();
  }
  if (!isComplete(status))
    throw new Error("same task did not complete after withdrawal");
  return [
    {
      assertionId: "directory-withdrawal-same-task-status",
      status: "passed",
      timestamp,
      origins: [input.client.origin],
      taskIdHash: hashTaskId(taskId),
    },
  ];
}

/** Assert a failed trust probe without reading or retaining its response body. */
export async function expectUnauthorized(
  fetchFn: InjectedFetch,
  url: string,
  init?: RequestInit,
): Promise<{ status: 401 }> {
  const response = await fetchFn(url, init);
  if (response.status !== 401)
    throw new Error(`expected 401, received ${response.status}`);
  return { status: 401 };
}

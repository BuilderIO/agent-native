import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: new Map<string, Record<string, unknown>>(),
  getSession: vi.fn(),
  getOrgContext: vi.fn(),
  getOAuthGrants: vi.fn(),
  getKeyConnections: vi.fn(),
  isPersonalGrantAllowed: vi.fn(),
  resolveAuthorization: vi.fn(),
  resolveCredentials: vi.fn(),
  resolveCredentialSource: vi.fn(),
  getCredentialAuthFailure: vi.fn(),
  startOAuth: vi.fn(),
  exchangeOAuth: vi.fn(),
  saveOAuth: vi.fn(),
  track: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("../deploy/route-discovery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../deploy/route-discovery.js")>()),
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  getSession: mocks.getSession,
}));

vi.mock("../org/context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/context.js")>()),
  getOrgContext: mocks.getOrgContext,
}));

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: async (key: string) => mocks.settings.get(key) ?? null,
  putSetting: async (key: string, value: Record<string, unknown>) => {
    mocks.settings.set(key, value);
  },
  deleteSetting: async (key: string) => mocks.settings.delete(key),
  mutateSetting: async (
    key: string,
    update: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ) => {
    const updated = await update(mocks.settings.get(key) ?? null);
    mocks.settings.set(key, updated);
    return updated;
  },
  listSettingsByPrefix: async (prefix: string) =>
    Array.from(mocks.settings.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value })),
}));

vi.mock("./builder-oauth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./builder-oauth.js")>()),
  getBuilderOAuthGrants: mocks.getOAuthGrants,
  isPersonalBuilderGrantAllowed: mocks.isPersonalGrantAllowed,
  startBuilderOAuthAuthorization: mocks.startOAuth,
  exchangeBuilderOAuthAuthorization: mocks.exchangeOAuth,
  saveBuilderOAuthCredentials: mocks.saveOAuth,
}));

vi.mock("./credential-provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./credential-provider.js")>()),
  getBuilderKeyConnections: mocks.getKeyConnections,
  resolveBuilderCredentials: mocks.resolveCredentials,
  resolveBuilderCredentialSource: mocks.resolveCredentialSource,
  getBuilderCredentialAuthFailure: mocks.getCredentialAuthFailure,
}));

vi.mock("./personal-provider-key-policy.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./personal-provider-key-policy.js")
  >()),
  readOrgMemberRole: vi.fn(async () => "member"),
}));

vi.mock("./builder-api-auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./builder-api-auth.js")>()),
  resolveBuilderRequestAuthorization: mocks.resolveAuthorization,
}));

vi.mock("./builder-browser.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./builder-browser.js")>()),
  resolveBuilderBranchProjectId: vi.fn(async () => ""),
}));

vi.mock("../tracking/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tracking/index.js")>()),
  track: mocks.track,
}));

vi.mock("../audit/org-admin.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../audit/org-admin.js")>()),
  recordOrgAdminAuditEvent: mocks.recordAudit,
}));

import { createCoreRoutesPlugin } from "./core-routes-plugin.js";

const OWNER = "owner@example.com";
const PREVIEW_ORIGIN = "https://forms.projects.builder.my";
const LOOPBACK_ORIGIN = "http://127.0.0.1:8080";
const FALLBACK_ORIGIN = "https://preview-branch-abc123.builderio.xyz";
const STATUS_PATH = "/_agent-native/builder/status";
const CALLBACK_PATH = "/_agent-native/builder/callback";

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

async function dispatch(
  nitroApp: any,
  url: string,
  headers: Record<string, string> = {},
) {
  const requestHeaders = new Headers(headers);
  const request = new Request(url, { headers: requestHeaders });
  const responseHeaders = new Headers();
  const event = {
    method: "GET",
    url: new URL(url),
    path: new URL(url).pathname,
    context: {},
    req: request,
    headers: requestHeaders,
    res: { status: 200, headers: responseHeaders },
    node: {
      req: {
        method: "GET",
        url: new URL(url).pathname + new URL(url).search,
        headers: Object.fromEntries(requestHeaders.entries()),
      },
      res: {
        statusCode: 200,
        setHeader(name: string, value: string) {
          responseHeaders.set(name, value);
        },
      },
    },
  };

  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    if (!middleware) return { fellThrough: true };
    return middleware(event, next);
  };

  const body = await next();
  return {
    body,
    status: event.res.status ?? event.node.res.statusCode,
    headers: responseHeaders,
    event,
  };
}

function getStatusConnectUrl(body: unknown): string {
  if (!body || typeof body !== "object") throw new Error("Missing status body");
  const connectUrl = (body as { connectUrl?: unknown }).connectUrl;
  if (typeof connectUrl !== "string") throw new Error("Missing connect URL");
  return connectUrl;
}

beforeEach(() => {
  mocks.settings.clear();
  mocks.getSession.mockReset().mockResolvedValue({
    email: OWNER,
    token: "session-token",
    emailVerified: true,
  });
  mocks.getOrgContext.mockReset().mockResolvedValue({
    email: OWNER,
    orgId: "org-example",
    role: "member",
  });
  mocks.getOAuthGrants.mockReset().mockResolvedValue({});
  mocks.getKeyConnections.mockReset().mockResolvedValue({});
  mocks.isPersonalGrantAllowed.mockReset().mockResolvedValue(true);
  mocks.resolveAuthorization.mockReset().mockResolvedValue(null);
  mocks.resolveCredentials.mockReset().mockResolvedValue({});
  mocks.resolveCredentialSource.mockReset().mockResolvedValue(null);
  mocks.getCredentialAuthFailure.mockReset().mockResolvedValue(null);
  mocks.startOAuth
    .mockReset()
    .mockImplementation(
      async ({
        redirectUri,
        state,
      }: {
        redirectUri: string;
        state: string;
      }) => ({
        authorizationUrl: `https://mcp.builder.io/authorize?state=${encodeURIComponent(state)}`,
        pending: { codeVerifier: "test-verifier", redirectUri },
      }),
    );
  mocks.exchangeOAuth.mockReset().mockResolvedValue({ accessToken: "fake" });
  mocks.saveOAuth.mockReset().mockResolvedValue("user");
  mocks.track.mockReset().mockResolvedValue(undefined);
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);

  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "builder-preview-origin-test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-auth-secret-for-builder-oauth");
  vi.stubEnv("FUSION_ENV_ORIGIN", FALLBACK_ORIGIN);
  vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
  vi.stubEnv("WORKSPACE_OAUTH_ORIGIN", LOOPBACK_ORIGIN + "/");
  vi.stubEnv("WORKSPACE_GATEWAY_URL", LOOPBACK_ORIGIN + "/");
  vi.stubEnv("APP_URL", LOOPBACK_ORIGIN + "/");
  vi.stubEnv("BETTER_AUTH_URL", LOOPBACK_ORIGIN + "/");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Builder preview-origin routes", () => {
  it("carries a Fusion alias from status through pending OAuth state and callback", async () => {
    const nitroApp = createNitroApp();
    await createCoreRoutesPlugin()(nitroApp);

    const status = await dispatch(nitroApp, LOOPBACK_ORIGIN + STATUS_PATH, {
      host: "127.0.0.1:8080",
      origin: PREVIEW_ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-agent-native-preview-origin": PREVIEW_ORIGIN,
    });
    expect(status.status).toBe(200);
    const connectUrl = getStatusConnectUrl(status.body);
    const parsedConnectUrl = new URL(connectUrl);
    expect(parsedConnectUrl.origin).toBe(PREVIEW_ORIGIN);
    expect(parsedConnectUrl.searchParams.get("_an_preview_origin")).toBe(
      PREVIEW_ORIGIN,
    );
    expect(
      parsedConnectUrl.searchParams.get("_an_preview_origin_signature"),
    ).toBeTruthy();

    const connect = await dispatch(
      nitroApp,
      LOOPBACK_ORIGIN + parsedConnectUrl.pathname + parsedConnectUrl.search,
      {
        host: "127.0.0.1:8080",
        "sec-fetch-site": "cross-site",
      },
    );
    expect(connect.status).toBe(302);
    const authorizationUrl = new URL(connect.headers.get("location") ?? "");
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const pendingKey = `builder-connect-pending:${state}`;
    expect(mocks.settings.get(pendingKey)).toEqual(
      expect.objectContaining({
        ownerEmail: OWNER,
        redirectUri: `${PREVIEW_ORIGIN}${CALLBACK_PATH}?state=${encodeURIComponent(state!)}`,
      }),
    );
    expect(mocks.startOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: OWNER,
        redirectUri: `${PREVIEW_ORIGIN}${CALLBACK_PATH}?state=${encodeURIComponent(state!)}`,
      }),
    );

    const callback = await dispatch(
      nitroApp,
      `${LOOPBACK_ORIGIN}${CALLBACK_PATH}?state=${encodeURIComponent(state!)}&code=authorization-code`,
      {
        host: "127.0.0.1:8080",
        "sec-fetch-site": "cross-site",
      },
    );
    expect(callback.status).toBe(200);
    expect(String(callback.body)).toContain(PREVIEW_ORIGIN);
    expect(String(callback.body)).not.toContain(FALLBACK_ORIGIN);
    expect(mocks.exchangeOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: OWNER,
        code: "authorization-code",
      }),
    );
    expect(mocks.saveOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ ownerEmail: OWNER, orgId: "org-example" }),
    );
    expect(mocks.settings.has(pendingKey)).toBe(false);
  });
});

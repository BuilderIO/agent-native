import { mockEvent } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOrgContext: vi.fn(),
  resolveSecret: vi.fn(),
  saveOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  resolveOAuthTokenBundleAccess: vi.fn(),
  listWorkspaceConnections: vi.fn(),
  resolveWorkspaceConnectionForApp: vi.fn(),
  upsertWorkspaceConnection: vi.fn(),
  upsertWorkspaceConnectionGrant: vi.fn(),
}));

vi.mock("./auth.js", async (original) => ({
  ...(await original<typeof import("./auth.js")>()),
  getSession: mocks.getSession,
}));
vi.mock("../org/context.js", async (original) => ({
  ...(await original<typeof import("../org/context.js")>()),
  getOrgContext: mocks.getOrgContext,
}));
vi.mock("./credential-provider.js", async (original) => ({
  ...(await original<typeof import("./credential-provider.js")>()),
  resolveSecret: mocks.resolveSecret,
}));
vi.mock("../oauth-tokens/store.js", async (original) => ({
  ...(await original<typeof import("../oauth-tokens/store.js")>()),
  saveOAuthTokens: mocks.saveOAuthTokens,
  setOAuthDisplayName: vi.fn(),
}));
vi.mock("../oauth-tokens/index.js", async (original) => ({
  ...(await original<typeof import("../oauth-tokens/index.js")>()),
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
  resolveOAuthTokenBundleAccess: mocks.resolveOAuthTokenBundleAccess,
}));
vi.mock("../workspace-connections/store.js", async (original) => ({
  ...(await original<typeof import("../workspace-connections/store.js")>()),
  listWorkspaceConnections: mocks.listWorkspaceConnections,
  resolveWorkspaceConnectionForApp: mocks.resolveWorkspaceConnectionForApp,
  upsertWorkspaceConnection: mocks.upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant: mocks.upsertWorkspaceConnectionGrant,
}));

import { getWorkspaceConnectionProvider } from "../connections/catalog.js";
import { resolveProviderApiOAuthAccessToken } from "../provider-api/index.js";
import { encryptSecretValue } from "../secrets/crypto.js";
import { encodeOAuthState } from "./google-oauth.js";
import {
  buildWorkspaceProviderAuthorizationUrl,
  handleWorkspaceProviderOAuthCallback,
  handleWorkspaceProviderOAuthStart,
  scopedOAuthAccountId,
  workspaceProviderOAuthPath,
  type WorkspaceProviderOAuthFlow,
} from "./workspace-provider-oauth.js";

const email = "qa-fleet@builder.io";
const otherEmail = "second-qa@example.test";
const orgId = "qa-workspace";
const appId = "brain-2";
const slackScopes = ["channels:read", "channels:history"];
const zoomScopes = [
  "user:read:user",
  "cloud_recording:read:list_user_recordings",
  "cloud_recording:read:list_recording_files",
];
const fixture = {
  access_token: "synthetic-access",
  refresh_token: "synthetic-refresh",
  expires_in: 3600,
};
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-oauth-cookie-test-secret");
  vi.stubGlobal("fetch", fetchMock);
  mocks.getSession.mockResolvedValue({ email });
  mocks.getOrgContext.mockResolvedValue({ email, orgId, role: "member" });
  mocks.resolveSecret.mockResolvedValue("synthetic-client-config");
  mocks.listWorkspaceConnections.mockResolvedValue([]);
  mocks.upsertWorkspaceConnection.mockResolvedValue({
    id: "fixture-connection",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function callbackEvent(
  provider: "slack" | "zoom",
  overrides: Partial<WorkspaceProviderOAuthFlow> = {},
) {
  const flow: WorkspaceProviderOAuthFlow = {
    provider,
    owner: email,
    orgId,
    appId,
    scope: "user",
    flowId: "fixture-flow",
    verifier: "fixture-verifier",
    redirectUri: `https://example.test${workspaceProviderOAuthPath(provider, "callback")}`,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
  const url = new URL(flow.redirectUri);
  url.searchParams.set("code", "fixture-code");
  url.searchParams.set(
    "state",
    encodeOAuthState({
      redirectUri: flow.redirectUri,
      owner: flow.owner,
      orgId: flow.orgId,
      app: flow.appId,
      scope: flow.scope,
      flowId: flow.flowId,
    }),
  );
  const cookie = encodeURIComponent(encryptSecretValue(JSON.stringify(flow)));
  return mockEvent(
    new Request(url, {
      headers: {
        cookie: `an_workspace_oauth_${provider}_${flow.flowId}=${cookie}`,
      },
    }),
  );
}

function slackGrant(scopes = slackScopes) {
  return {
    ok: true,
    access_token: "synthetic-bot-access",
    team: { id: "T_FIXTURE", name: "Fixture workspace" },
    authed_user: {
      ...fixture,
      id: "U_FIXTURE",
      token_type: "user",
      scope: scopes.join(","),
    },
  };
}

describe("workspace OAuth consent", () => {
  it.each(["slack", "zoom"] as const)(
    "reports absent %s client configuration and rejects shared consent",
    async (provider) => {
      mocks.resolveSecret.mockResolvedValue(null);
      for (const [scope, status] of [
        ["user", 503],
        ["organization", 403],
        ["app", 403],
      ] as const) {
        const event = mockEvent(
          new Request(
            `https://example.test${workspaceProviderOAuthPath(provider, "start")}?appId=${appId}&scope=${scope}`,
          ),
        );
        await handleWorkspaceProviderOAuthStart(event, provider);
        expect(event.res.status).toBe(status);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("requests a Slack user grant and Zoom separates required and optional scopes", () => {
    const input = {
      clientId: "fixture",
      redirectUri: "https://example.test/callback",
      state: "fixture",
      challenge: "fixture",
    };
    const slackProvider = getWorkspaceConnectionProvider("slack");
    const zoomProvider = getWorkspaceConnectionProvider("zoom");
    if (!slackProvider || !zoomProvider)
      throw new Error("Workspace OAuth catalog entries are missing.");
    const slack = new URL(
      buildWorkspaceProviderAuthorizationUrl({
        ...input,
        provider: slackProvider,
        optionalScopes: ["search:read.public"],
      }),
    );
    expect(slack.searchParams.get("user_scope")).toBe(
      [...slackScopes, "search:read.public"].join(","),
    );
    expect(slack.searchParams.has("scope")).toBe(false);
    const zoom = new URL(
      buildWorkspaceProviderAuthorizationUrl({
        ...input,
        provider: zoomProvider,
        requestedScopes: [zoomScopes[1]],
        optionalScopes: [zoomScopes[2]],
      }),
    );
    expect(zoom.searchParams.get("scope")).toBe(
      zoomScopes.slice(0, 2).join(" "),
    );
    expect(zoom.searchParams.get("optional_scope")).toBe(zoomScopes[2]);
  });

  it.each([{ allowedApps: [] }, { allowedApps: ["mail"] }])(
    "reuses the Slack connection and preserves allowedApps (%j)",
    async ({ allowedApps }) => {
      const accountId = scopedOAuthAccountId(
        "slack",
        email,
        JSON.stringify([orgId, JSON.stringify(["T_FIXTURE", "U_FIXTURE"])]),
      );
      mocks.listWorkspaceConnections.mockResolvedValue([
        {
          id: "fixture-connection",
          accountId,
          allowedApps,
          allowedUsers: [email],
        },
      ]);
      fetchMock.mockResolvedValueOnce(Response.json(slackGrant()));
      const result = await handleWorkspaceProviderOAuthCallback(
        callbackEvent("slack", { requestedScopes: slackScopes }),
        "slack",
      );
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).headers.get("location")).toContain(
        "connected=slack",
      );
      const saved = mocks.saveOAuthTokens.mock.calls[0]?.[2];
      expect(saved).toMatchObject({
        access_token: fixture.access_token,
        personalProviderOAuth: true,
      });
      expect(saved.access_token).not.toBe(slackGrant().access_token);
      expect(mocks.upsertWorkspaceConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "fixture-connection",
          accountId,
          allowedApps,
          allowedUsers: [email],
          scopes: slackScopes,
        }),
      );
      expect(mocks.upsertWorkspaceConnectionGrant).toHaveBeenCalledTimes(
        allowedApps.length === 0 ? 1 : 0,
      );
    },
  );

  it("exchanges Zoom consent and saves the hosted-recording grant", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ ...fixture, scope: zoomScopes.join(" ") }),
      )
      .mockResolvedValueOnce(Response.json({ id: "zoom-fixture-user" }));
    const result = await handleWorkspaceProviderOAuthCallback(
      callbackEvent("zoom"),
      "zoom",
    );
    expect(result).toBeInstanceOf(Response);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://zoom.us/oauth/token",
      "https://api.zoom.us/v2/users/me",
    ]);
    expect(mocks.upsertWorkspaceConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "zoom",
        allowedApps: [],
        allowedUsers: [email],
        scopes: zoomScopes,
        config: expect.objectContaining({ workspaceConnectionScope: "user" }),
      }),
    );
  });

  it.each(["wrong user", "wrong org", "wrong scope", "expired state"] as const)(
    "rejects callback with %s before provider access",
    async (failure) => {
      const event = callbackEvent("slack", {
        ...(failure === "wrong user" ? { owner: otherEmail } : {}),
        ...(failure === "wrong org" ? { orgId: "second-workspace" } : {}),
        ...(failure === "wrong scope" ? { scope: "organization" } : {}),
        ...(failure === "expired state" ? { expiresAt: Date.now() - 1 } : {}),
      });
      await handleWorkspaceProviderOAuthCallback(event, "slack");
      expect(event.res.status).toBeGreaterThanOrEqual(400);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.saveOAuthTokens).not.toHaveBeenCalled();
    },
  );

  it("does not persist a bot-only response or a user grant missing the selected scopes", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ ok: true, access_token: "synthetic-bot-access" }),
    );
    await expect(
      handleWorkspaceProviderOAuthCallback(callbackEvent("slack"), "slack"),
    ).rejects.toThrow("OAuth token exchange failed");
    fetchMock.mockResolvedValueOnce(
      Response.json(slackGrant(["channels:read"])),
    );
    const event = callbackEvent("slack");
    await handleWorkspaceProviderOAuthCallback(event, "slack");
    expect(event.res.status).toBe(400);
    expect(mocks.saveOAuthTokens).not.toHaveBeenCalled();
  });
});

describe("workspace OAuth runtime", () => {
  function setup(provider: "slack" | "zoom", expiry = Date.now() + 600_000) {
    const scopes = provider === "slack" ? slackScopes : zoomScopes;
    const connection = {
      id: "fixture-connection",
      label: "Fixture",
      ownerEmail: email,
      orgId,
      scopes,
      accountId: "fixture-account",
      config: { workspaceConnectionScope: "user", personalProviderOAuth: true },
    };
    const tokens = {
      ...fixture,
      expiry_date: expiry,
      scope: scopes.join(" "),
      personalProviderOAuth: true,
    };
    mocks.resolveWorkspaceConnectionForApp.mockResolvedValue({
      available: true,
      connection,
    });
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      { accountId: connection.accountId, tokens },
    ]);
    return {
      connection,
      tokens,
      resolve: (
        ctx: { userEmail: string; orgId: string; credentialScope?: "org" } = {
          userEmail: email,
          orgId,
        },
        requiredScopes = scopes,
      ) =>
        resolveProviderApiOAuthAccessToken(
          { provider, connectionId: connection.id, requiredScopes },
          {
            appId: "consumer-app",
            providerIds: [provider],
            getCredentialContext: () => ctx,
          },
        ),
    };
  }

  it.each(["slack", "zoom"] as const)(
    "resolves %s cross-app by reference and reports upstream revocation",
    async (provider) => {
      const { resolve } = setup(provider);
      fetchMock.mockResolvedValueOnce(
        Response.json(
          provider === "slack" ? { ok: true } : { id: "zoom-fixture-user" },
        ),
      );
      await expect(resolve()).resolves.toMatchObject({
        connectionId: "fixture-connection",
        accessToken: fixture.access_token,
      });
      expect(mocks.resolveWorkspaceConnectionForApp).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: "consumer-app",
          connectionId: "fixture-connection",
          requireConnected: true,
        }),
      );
      fetchMock.mockResolvedValueOnce(
        Response.json(
          { ok: false, error: "token_revoked" },
          { status: provider === "slack" ? 200 : 401 },
        ),
      );
      await expect(resolve()).rejects.toMatchObject({ reason: "reauthorize" });
    },
  );

  it("denies wrong user, organization, access scope, operation scope, and revoked grants before reading tokens", async () => {
    const { resolve } = setup("slack");
    await expect(resolve({ userEmail: otherEmail, orgId })).rejects.toThrow();
    await expect(
      resolve({ userEmail: email, orgId: "second-workspace" }),
    ).rejects.toThrow();
    await expect(
      resolve({ userEmail: email, orgId, credentialScope: "org" }),
    ).rejects.toThrow();
    await expect(resolve(undefined, ["search:read.public"])).rejects.toThrow();
    mocks.resolveWorkspaceConnectionForApp.mockResolvedValue({
      available: false,
      connection: null,
      reason: "Grant revoked.",
    });
    await expect(resolve()).rejects.toThrow("Grant revoked");
    expect(mocks.listOAuthAccountsByOwner).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["slack", "zoom"] as const)(
    "rotates an expired %s grant under the token lifecycle lease",
    async (provider) => {
      const { resolve, tokens } = setup(provider, Date.now() - 1);
      mocks.resolveOAuthTokenBundleAccess.mockImplementation(
        async (_identity, { refresh }) => refresh(tokens),
      );
      fetchMock
        .mockResolvedValueOnce(
          Response.json({
            ...fixture,
            ok: true,
            token_type: "user",
            access_token: "synthetic-rotated-access",
            refresh_token: "synthetic-rotated-refresh",
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ ok: true, id: "zoom-fixture-user" }),
        );
      await expect(resolve()).resolves.toMatchObject({
        accessToken: "synthetic-rotated-access",
      });
      expect(mocks.resolveOAuthTokenBundleAccess).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0]?.[1]?.body.get("grant_type")).toBe(
        "refresh_token",
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("rejects expired credentials when the refresh token is absent", async () => {
    const { resolve, tokens } = setup("zoom", Date.now() - 1);
    mocks.resolveOAuthTokenBundleAccess.mockImplementation(
      async (_identity, { refresh }) =>
        refresh({ ...tokens, refresh_token: undefined }),
    );
    await expect(resolve()).rejects.toThrow("Zoom OAuth token has expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

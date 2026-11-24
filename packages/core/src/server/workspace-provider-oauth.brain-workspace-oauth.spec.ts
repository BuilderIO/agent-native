import { mockEvent } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOrgContext: vi.fn(),
  resolveSecret: vi.fn(),
  saveOAuthTokens: vi.fn(),
  listWorkspaceConnections: vi.fn(),
  getWorkspaceConnectionGrant: vi.fn(),
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
vi.mock("../workspace-connections/store.js", async (original) => ({
  ...(await original<typeof import("../workspace-connections/store.js")>()),
  listWorkspaceConnections: mocks.listWorkspaceConnections,
  getWorkspaceConnectionGrant: mocks.getWorkspaceConnectionGrant,
  upsertWorkspaceConnection: mocks.upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant: mocks.upsertWorkspaceConnectionGrant,
}));

import { getWorkspaceConnectionProvider } from "../connections/catalog.js";
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
  "user:read:email",
  "meeting:read:list_meetings",
  "meeting:read:meeting",
  "meeting:update:meeting",
  "cloud_recording:read:list_user_recordings",
  "cloud_recording:read:list_recording_files",
  "cloud_recording:read:meeting_transcript",
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
  mocks.getWorkspaceConnectionGrant.mockResolvedValue(null);
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
    const defaultZoom = new URL(
      buildWorkspaceProviderAuthorizationUrl({
        ...input,
        provider: zoomProvider,
      }),
    );
    expect(defaultZoom.searchParams.get("scope")).toBe(zoomScopes.join(" "));
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

  it.each([
    { allowedApps: [], explicitGrant: false },
    { allowedApps: [appId], explicitGrant: false },
    { allowedApps: ["mail"], explicitGrant: true },
  ])(
    "reuses the Slack connection and preserves an app's existing access (%j)",
    async ({ allowedApps, explicitGrant }) => {
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
      if (explicitGrant) {
        mocks.getWorkspaceConnectionGrant.mockResolvedValue({
          id: "fixture-grant",
          appId,
          connectionId: "fixture-connection",
          config: { fixturePolicy: true },
          credentialRefs: [],
        });
      }
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
      expect(mocks.upsertWorkspaceConnectionGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          appId,
          connectionId: "fixture-connection",
          scopes: slackScopes,
          config: expect.objectContaining(
            explicitGrant
              ? { fixturePolicy: true }
              : { personalProviderOAuth: true },
          ),
        }),
      );
    },
  );

  it("denies reconnect from an app without access before changing the shared token", async () => {
    const accountId = scopedOAuthAccountId(
      "slack",
      email,
      JSON.stringify([orgId, JSON.stringify(["T_FIXTURE", "U_FIXTURE"])]),
    );
    mocks.listWorkspaceConnections.mockResolvedValue([
      {
        id: "fixture-connection",
        accountId,
        allowedApps: ["mail"],
        allowedUsers: [email],
      },
    ]);
    fetchMock.mockResolvedValueOnce(Response.json(slackGrant()));
    const event = callbackEvent("slack");
    await handleWorkspaceProviderOAuthCallback(event, "slack");
    expect(event.res.status).toBe(403);
    expect(mocks.saveOAuthTokens).not.toHaveBeenCalled();
    expect(mocks.upsertWorkspaceConnectionGrant).not.toHaveBeenCalled();
  });

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

  it("accepts additional Zoom scopes while recording only the requested scopes", async () => {
    const extraScopes = ["user:read:extra"];
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          ...fixture,
          scope: [...zoomScopes, ...extraScopes].join(" "),
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: "zoom-fixture-user" }));
    const result = await handleWorkspaceProviderOAuthCallback(
      callbackEvent("zoom"),
      "zoom",
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toContain(
      "connected=zoom",
    );
    expect(mocks.upsertWorkspaceConnection).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: zoomScopes }),
    );
    expect(mocks.upsertWorkspaceConnectionGrant).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: zoomScopes }),
    );
  });

  it("rejects a Zoom grant missing a required scope even with extra scopes", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        ...fixture,
        scope: [zoomScopes[0], zoomScopes[1], "meeting:read:meeting"].join(" "),
      }),
    );
    const event = callbackEvent("zoom");
    await handleWorkspaceProviderOAuthCallback(event, "zoom");
    expect(event.res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.saveOAuthTokens).not.toHaveBeenCalled();
    expect(mocks.upsertWorkspaceConnection).not.toHaveBeenCalled();
    expect(mocks.upsertWorkspaceConnectionGrant).not.toHaveBeenCalled();
  });

  it.each([
    { extraScopes: ["identify"] },
    { extraScopes: ["identify", "users:read"] },
  ])(
    "accepts extra Slack scopes %j without recording them",
    async ({ extraScopes }) => {
      fetchMock.mockResolvedValueOnce(
        Response.json(slackGrant([...slackScopes, ...extraScopes])),
      );
      const result = await handleWorkspaceProviderOAuthCallback(
        callbackEvent("slack"),
        "slack",
      );
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).headers.get("location")).toContain(
        "connected=slack",
      );
      expect(mocks.upsertWorkspaceConnection).toHaveBeenCalledWith(
        expect.objectContaining({ scopes: slackScopes }),
      );
      expect(mocks.upsertWorkspaceConnectionGrant).toHaveBeenCalledWith(
        expect.objectContaining({ scopes: slackScopes }),
      );
    },
  );

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

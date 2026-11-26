import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSecret: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  resolveOAuthTokenBundleAccess: vi.fn(),
  resolveWorkspaceConnectionForApp: vi.fn(),
}));

vi.mock("../server/credential-provider.js", async (original) => ({
  ...(await original<typeof import("../server/credential-provider.js")>()),
  resolveSecret: mocks.resolveSecret,
}));
vi.mock("../oauth-tokens/index.js", async (original) => ({
  ...(await original<typeof import("../oauth-tokens/index.js")>()),
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
  resolveOAuthTokenBundleAccess: mocks.resolveOAuthTokenBundleAccess,
}));
vi.mock("../workspace-connections/store.js", async (original) => ({
  ...(await original<typeof import("../workspace-connections/store.js")>()),
  resolveWorkspaceConnectionForApp: mocks.resolveWorkspaceConnectionForApp,
}));

import {
  createProviderApiRuntime,
  resolveProviderApiOAuthAccessToken,
  type ProviderApiCredentialResolver,
} from "./index.js";

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
  vi.stubGlobal("fetch", fetchMock);
  mocks.resolveSecret.mockResolvedValue("synthetic-client-config");
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it.each([
    { provider: "zoom", extraScopes: ["meeting:read:meeting"] },
    { provider: "slack", extraScopes: ["identify"] },
    { provider: "slack", extraScopes: ["identify", "users:read"] },
  ] as const)(
    "accepts additional $provider token scopes without granting them to the app",
    async ({ provider, extraScopes }) => {
      const { resolve, tokens } = setup(provider);
      tokens.scope = [tokens.scope, ...extraScopes].join(" ");
      fetchMock.mockResolvedValueOnce(
        Response.json(
          provider === "slack" ? { ok: true } : { id: "zoom-fixture-user" },
        ),
      );
      await expect(resolve()).resolves.toMatchObject({
        accessToken: fixture.access_token,
      });
      await expect(resolve(undefined, [...extraScopes])).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["slack", "zoom"] as const)(
    "rejects %s tokens missing a required scope even when extras are present",
    async (provider) => {
      const { resolve, tokens } = setup(provider);
      const scopes = provider === "slack" ? slackScopes : zoomScopes;
      tokens.scope = [scopes[0], "unrelated:scope"].join(" ");
      await expect(resolve()).rejects.toMatchObject({ reason: "reauthorize" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects an operation missing from the app grant despite a broader token", async () => {
    const { resolve, connection, tokens } = setup("slack");
    tokens.scope = [...slackScopes, "identify", "users:read"].join(" ");
    mocks.resolveWorkspaceConnectionForApp.mockResolvedValue({
      available: true,
      connection: {
        ...connection,
        explicitGrant: { scopes: ["channels:read"] },
      },
    });
    await expect(resolve(undefined, ["channels:history"])).rejects.toThrow();
    expect(mocks.listOAuthAccountsByOwner).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps ordinary requests on the configured bot credential and rejects unscoped personal requests", async () => {
    const { connection } = setup("slack");
    const botCredential = "synthetic-legacy-credential";
    const resolveCredential = vi.fn<ProviderApiCredentialResolver>(
      async () => ({
        key: "SLACK_BOT_TOKEN",
        value: botCredential,
        source: "app_local",
        provider: "slack",
      }),
    );
    const runtime = createProviderApiRuntime({
      appId,
      providerIds: ["slack"],
      getCredentialContext: () => ({ userEmail: email, orgId }),
      resolveCredential,
    });
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));

    await runtime.executeRequest({ provider: "slack", path: "/auth.test" });
    expect(resolveCredential).toHaveBeenCalledWith(
      expect.objectContaining({ key: "SLACK_BOT_TOKEN" }),
    );
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe(`Bearer ${botCredential}`);

    resolveCredential.mockResolvedValueOnce(null);
    await expect(
      runtime.executeRequest({
        provider: "slack",
        path: "/auth.test",
        connectionId: connection.id,
      }),
    ).rejects.toThrow("requires a selected connection and operation scopes");
    expect(mocks.listOAuthAccountsByOwner).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
    await expect(resolve(undefined, [])).rejects.toThrow();
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
            scope: `${tokens.scope} unrelated:scope`,
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

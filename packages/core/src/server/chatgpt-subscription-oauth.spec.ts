import crypto from "node:crypto";

import * as jose from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHATGPT_SUBSCRIPTION_ACTIVE_ACCOUNT_SETTING_KEY,
  CHATGPT_SUBSCRIPTION_RESOURCE,
  CHATGPT_SUBSCRIPTION_SCOPES,
} from "../agent/chatgpt-subscription-contract.js";
import { CHATGPT_SUBSCRIPTION_LAB } from "../labs/core-labs.js";
import { _resetLabRegistryForTests, registerLabs } from "../labs/registry.js";

const mocks = vi.hoisted(() => ({
  getUserLabEnabled: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
  deleteUserSetting: vi.fn(),
  readOAuthCredentialState: vi.fn(),
}));

vi.mock("../labs/store.js", () => mocks);
// Account reads hit the settings and OAuth tables, which a fresh test database
// does not have. Each read defaults to "no account"; a test that seeds an
// account must set the mock itself. The unresolved-scope test asserts that the
// credential check never reads them; its status call reads them on purpose.
// The mocked credential reader skips isChatGPTCredential, so seeded credentials
// must pass that validator by hand.
vi.mock("../oauth-tokens/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../oauth-tokens/index.js")>()),
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
  readOAuthCredentialState: mocks.readOAuthCredentialState,
}));
vi.mock("../settings/user-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/user-settings.js")>()),
  getUserSetting: mocks.getUserSetting,
  mutateUserSetting: vi.fn(),
  putUserSetting: mocks.putUserSetting,
  deleteUserSetting: mocks.deleteUserSetting,
}));

import {
  getChatGPTSubscriptionAccess,
  getChatGPTSubscriptionStatus,
  hasChatGPTSubscriptionCredential,
  isChatGPTSubscriptionLoopbackCallbackUri,
  parseChatGPTSubscriptionRevocationEndpoint,
  parseChatGPTSubscriptionScopes,
  requestTokens,
  tokenCredential,
  verifyChatGPTSubscriptionIdToken,
} from "./chatgpt-subscription-oauth.js";
import { runWithRequestContext } from "./request-context.js";

const CLIENT_ID = "oaiapp_test-client";
const NONCE = "fresh-test-nonce";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserLabEnabled.mockResolvedValue(false);
  mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
  mocks.getUserSetting.mockResolvedValue(null);
  mocks.readOAuthCredentialState.mockResolvedValue({ kind: "missing" });
  _resetLabRegistryForTests();
  registerLabs([CHATGPT_SUBSCRIPTION_LAB]);
});

describe("ChatGPT subscription OAuth contract", () => {
  it("keeps ChatGPT credentials unavailable until the lab is enabled", async () => {
    await runWithRequestContext(
      {
        isLoopbackRequest: true,
        isDirectLoopbackRequest: true,
        requestOrigin: "http://127.0.0.1:1455",
        orgScope: "personal",
      },
      async () => {
        await expect(
          hasChatGPTSubscriptionCredential("alice@example.com"),
        ).resolves.toBe(false);
        await expect(
          getChatGPTSubscriptionAccess("alice@example.com"),
        ).rejects.toThrow(
          "Enable ChatGPT plan access in Settings → Labs first.",
        );
      },
    );
    expect(mocks.getUserLabEnabled).toHaveBeenCalledTimes(2);
  });

  it("does not grant local ChatGPT credentials to a durable worker", async () => {
    mocks.getUserLabEnabled.mockResolvedValue(true);

    await runWithRequestContext(
      {
        isLoopbackRequest: true,
        isDirectLoopbackRequest: true,
        requestOrigin: "http://127.0.0.1:1455",
        orgScope: "personal",
        run: { isBackgroundWorker: true },
      },
      async () => {
        await expect(
          hasChatGPTSubscriptionCredential("alice@example.com"),
        ).resolves.toBe(false);
      },
    );
  });

  it("does not treat a loopback request with unresolved scope as personal", async () => {
    mocks.getUserLabEnabled.mockResolvedValue(true);

    await runWithRequestContext(
      {
        isLoopbackRequest: true,
        isDirectLoopbackRequest: true,
        requestOrigin: "http://127.0.0.1:1455",
      },
      async () => {
        await expect(
          hasChatGPTSubscriptionCredential("alice@example.com"),
        ).resolves.toBe(false);
        expect(mocks.listOAuthAccountsByOwner).not.toHaveBeenCalled();
        expect(mocks.getUserSetting).not.toHaveBeenCalled();
        // Unresolved request scope is not enough to read a user's account list,
        // even for a status response that will be unsupported either way.
        await expect(
          getChatGPTSubscriptionStatus("alice@example.com"),
        ).resolves.toMatchObject({
          supported: false,
          localLoopback: false,
          supportReason: "requires_local_loopback",
          accounts: [],
        });
        expect(mocks.getUserLabEnabled).not.toHaveBeenCalled();
        expect(mocks.listOAuthAccountsByOwner).not.toHaveBeenCalled();
        expect(mocks.getUserSetting).not.toHaveBeenCalled();
        await expect(
          getChatGPTSubscriptionAccess("alice@example.com"),
        ).rejects.toThrow("available only from a local app");
      },
    );
  });

  it("does not expose saved accounts to a forwarded loopback request", async () => {
    mocks.getUserLabEnabled.mockResolvedValue(true);
    const subject = "subject-alice";
    const accountId = `siwc_${crypto
      .createHash("sha256")
      .update(JSON.stringify(["alice@example.com", CLIENT_ID, subject]))
      .digest("hex")}`;
    const resourceSuffix = `:resource:${crypto
      .createHash("sha256")
      .update(CHATGPT_SUBSCRIPTION_RESOURCE)
      .digest("hex")}`;
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      { accountId: `${accountId}${resourceSuffix}` },
    ]);
    mocks.readOAuthCredentialState.mockResolvedValue({
      kind: "connected",
      credential: {
        clientId: CLIENT_ID,
        subject,
        email: "alice@example.com",
        displayName: "Alice",
        extAgentHostId: "urn:uuid:11111111-1111-4111-8111-111111111111",
        idToken: "id-token-alice",
        tokenExpiresAt: Date.now() + 60 * 60 * 1000,
        grantedScopes: [...CHATGPT_SUBSCRIPTION_SCOPES],
        tokens: {
          access_token: "access-alice",
          refresh_token: "refresh-alice",
        },
      },
    });

    await runWithRequestContext(
      {
        isLoopbackRequest: true,
        isDirectLoopbackRequest: false,
        requestOrigin: "http://127.0.0.1:1455",
        orgScope: "personal",
      },
      async () => {
        await expect(
          hasChatGPTSubscriptionCredential("alice@example.com"),
        ).resolves.toBe(false);
        await expect(
          getChatGPTSubscriptionStatus("alice@example.com"),
        ).resolves.toMatchObject({
          supported: false,
          localLoopback: false,
          connected: false,
          accounts: [],
        });
        expect(mocks.getUserLabEnabled).not.toHaveBeenCalled();
        expect(mocks.listOAuthAccountsByOwner).not.toHaveBeenCalled();
        expect(mocks.getUserSetting).not.toHaveBeenCalled();
        await expect(
          getChatGPTSubscriptionAccess("alice@example.com"),
        ).rejects.toThrow("available only from a local app");
      },
    );
    expect(mocks.getUserLabEnabled).not.toHaveBeenCalled();
  });

  it("reads account summaries without the lab preference for a non-loopback status request", async () => {
    await runWithRequestContext(
      {
        isLoopbackRequest: false,
        isDirectLoopbackRequest: false,
        requestOrigin: "https://app.example.com",
        orgScope: "organization",
      },
      async () => {
        await expect(
          getChatGPTSubscriptionStatus("alice@example.com"),
        ).resolves.toMatchObject({
          supported: false,
          localLoopback: false,
          supportReason: "requires_local_loopback",
        });
      },
    );

    expect(mocks.getUserLabEnabled).not.toHaveBeenCalled();
    expect(mocks.listOAuthAccountsByOwner).toHaveBeenCalled();
  });

  it("reports saved accounts in an unsupported status without granting access", async () => {
    mocks.getUserLabEnabled.mockResolvedValue(true);
    const subject = "subject-alice";
    const accountId = `siwc_${crypto
      .createHash("sha256")
      .update(JSON.stringify(["alice@example.com", CLIENT_ID, subject]))
      .digest("hex")}`;
    const resourceSuffix = `:resource:${crypto
      .createHash("sha256")
      .update(CHATGPT_SUBSCRIPTION_RESOURCE)
      .digest("hex")}`;
    const legacyResourceSuffix = `:resource:${crypto
      .createHash("sha256")
      .update("https://chatgpt.com/backend-api/codex/responses")
      .digest("hex")}`;
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      { accountId: `${accountId}${resourceSuffix}` },
      { accountId: `user:alice@example.com${legacyResourceSuffix}` },
    ]);
    const credential = {
      clientId: CLIENT_ID,
      subject,
      email: "alice@example.com",
      displayName: "Alice",
      extAgentHostId: "urn:uuid:11111111-1111-4111-8111-111111111111",
      idToken: "id-token-alice",
      tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      grantedScopes: [...CHATGPT_SUBSCRIPTION_SCOPES],
      tokens: {
        access_token: "access-alice",
        refresh_token: "refresh-alice",
      },
    };
    mocks.readOAuthCredentialState.mockResolvedValue({
      kind: "connected",
      credential,
    });
    let activeAccountSetting: { accountId: string } | null = { accountId };
    mocks.getUserSetting.mockImplementation(async (_email, key) =>
      key === CHATGPT_SUBSCRIPTION_ACTIVE_ACCOUNT_SETTING_KEY
        ? activeAccountSetting
        : null,
    );

    await runWithRequestContext(
      {
        isLoopbackRequest: false,
        isDirectLoopbackRequest: false,
        requestOrigin: "https://app.example.com",
        orgScope: "organization",
      },
      async () => {
        await expect(
          hasChatGPTSubscriptionCredential("alice@example.com"),
        ).resolves.toBe(false);
        await expect(
          getChatGPTSubscriptionStatus("alice@example.com"),
        ).resolves.toMatchObject({
          supported: false,
          localLoopback: false,
          connected: false,
          activeAccountId: accountId,
          activeAccount: expect.objectContaining({
            id: accountId,
            active: true,
          }),
          accounts: [
            expect.objectContaining({
              id: accountId,
              email: "alice@example.com",
              label: "Alice",
              connected: true,
              active: true,
            }),
          ],
          legacyRegistrationCleanupAvailable: true,
        });
        await expect(
          getChatGPTSubscriptionAccess("alice@example.com"),
        ).rejects.toThrow("available only from a local app");

        activeAccountSetting = null;
        await expect(
          getChatGPTSubscriptionStatus("alice@example.com"),
        ).resolves.toMatchObject({
          supported: false,
          activeAccountId: accountId,
          activeAccount: expect.objectContaining({
            id: accountId,
            active: true,
          }),
          accounts: [expect.objectContaining({ id: accountId, active: true })],
          legacyRegistrationCleanupAvailable: true,
        });
        expect(mocks.putUserSetting).toHaveBeenCalledWith(
          "alice@example.com",
          CHATGPT_SUBSCRIPTION_ACTIVE_ACCOUNT_SETTING_KEY,
          { accountId },
        );

        mocks.readOAuthCredentialState.mockResolvedValue({
          kind: "reconnect_required",
          credential,
        });
        await expect(
          getChatGPTSubscriptionStatus("alice@example.com"),
        ).resolves.toMatchObject({
          supported: false,
          reconnectRequired: true,
          activeAccount: expect.objectContaining({
            id: accountId,
            connected: false,
            reconnectRequired: true,
          }),
          accounts: [
            expect.objectContaining({
              id: accountId,
              active: true,
              connected: false,
              reconnectRequired: true,
            }),
          ],
          legacyRegistrationCleanupAvailable: true,
        });
      },
    );
  });

  it("surfaces lab preference read failures instead of treating them as off", async () => {
    const error = new Error("settings unavailable");
    mocks.getUserLabEnabled.mockRejectedValue(error);

    await runWithRequestContext(
      {
        isLoopbackRequest: true,
        isDirectLoopbackRequest: true,
        requestOrigin: "http://127.0.0.1:1455",
        orgScope: "personal",
      },
      async () => {
        await expect(
          hasChatGPTSubscriptionCredential("alice@example.com"),
        ).rejects.toBe(error);
      },
    );
  });

  it("reports unsupported when the app did not register the ChatGPT lab", async () => {
    _resetLabRegistryForTests();

    await runWithRequestContext(
      {
        isLoopbackRequest: true,
        isDirectLoopbackRequest: true,
        requestOrigin: "http://127.0.0.1:1455",
        orgScope: "personal",
      },
      async () => {
        await expect(
          getChatGPTSubscriptionStatus("alice@example.com"),
        ).resolves.toMatchObject({
          supported: false,
          supportReason: "requires_lab",
          connected: false,
          accounts: [],
        });
      },
    );
    expect(mocks.getUserLabEnabled).not.toHaveBeenCalled();
  });

  it("does not grant local ChatGPT access through a forwarded loopback request", async () => {
    mocks.getUserLabEnabled.mockResolvedValue(true);

    await runWithRequestContext(
      {
        isLoopbackRequest: true,
        isDirectLoopbackRequest: false,
        requestOrigin: "http://127.0.0.1:1455",
        orgScope: "personal",
      },
      async () => {
        await expect(
          getChatGPTSubscriptionStatus("alice@example.com"),
        ).resolves.toMatchObject({
          supported: false,
          localLoopback: false,
          supportReason: "requires_local_loopback",
        });
        await expect(
          getChatGPTSubscriptionAccess("alice@example.com"),
        ).rejects.toThrow("available only from a local app");
      },
    );
    expect(mocks.getUserLabEnabled).not.toHaveBeenCalled();
  });

  it("accepts only the fixed HTTP 127.0.0.1 callback URI", () => {
    expect(
      isChatGPTSubscriptionLoopbackCallbackUri(
        "http://127.0.0.1:1455/auth/callback",
      ),
    ).toBe(true);
    expect(
      isChatGPTSubscriptionLoopbackCallbackUri(
        "http://127.0.0.1/auth/callback",
      ),
    ).toBe(true);

    for (const value of [
      "http://localhost:1455/auth/callback",
      "https://127.0.0.1:1455/auth/callback",
      "http://127.0.0.2:1455/auth/callback",
      "http://127.0.0.1:0/auth/callback",
      "http://127.0.0.1:1455/callback",
      "http://127.0.0.1:1455/auth/callback?next=https://example.test",
      "http://127.0.0.1:1455/auth/callback#fragment",
      "http://user@127.0.0.1:1455/auth/callback",
    ]) {
      expect(isChatGPTSubscriptionLoopbackCallbackUri(value)).toBe(false);
    }
  });

  it("does not forward token grants through redirects", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        return new Response(JSON.stringify({ access_token: "test-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        requestTokens({ grant_type: "authorization_code" }),
      ).resolves.toMatchObject({ access_token: "test-token" });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requires every requested identity and direct-plan scope", () => {
    expect(
      parseChatGPTSubscriptionScopes(
        "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      ),
    ).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
      "resource.invoke",
      "chatgpt.tokens.use.direct",
    ]);
    expect(() =>
      parseChatGPTSubscriptionScopes(
        "openid profile email offline_access resource.invoke",
      ),
    ).toThrow("chatgpt.tokens.use.direct");
    expect(() => parseChatGPTSubscriptionScopes(undefined)).toThrow(
      "no granted scopes",
    );
  });

  it("retains previously granted scopes when a refresh omits scope", () => {
    const previousScopes = [
      "openid",
      "profile",
      "email",
      "offline_access",
      "resource.invoke",
      "chatgpt.tokens.use.direct",
    ];
    const identity = {
      clientId: CLIENT_ID,
      hostId: "urn:uuid:00000000-0000-4000-8000-000000000001",
      subject: "verified-subject",
      idToken: "verified-id-token",
    };
    const previous = {
      tokens: { access_token: "old-access", refresh_token: "old-refresh" },
      tokenExpiresAt: Date.now() + 60_000,
      ...identity,
      extAgentHostId: identity.hostId,
      grantedScopes: previousScopes,
    };

    expect(
      tokenCredential(
        {
          access_token: "new-access",
          refresh_token: "rotated-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        },
        identity,
        previous,
      ).grantedScopes,
    ).toEqual(previousScopes);

    expect(() =>
      tokenCredential(
        {
          access_token: "new-access",
          refresh_token: "rotated-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid profile email offline_access resource.invoke",
        },
        identity,
        previous,
      ),
    ).toThrow("chatgpt.tokens.use.direct");
  });

  it("accepts only the discovered HTTPS OpenAI revocation endpoint", () => {
    expect(
      parseChatGPTSubscriptionRevocationEndpoint({
        issuer: "https://auth.openai.com",
        revocation_endpoint: "https://auth.openai.com/api/accounts/revoke",
      }),
    ).toBe("https://auth.openai.com/api/accounts/revoke");

    for (const metadata of [
      {
        issuer: "https://auth.openai.com",
        revocation_endpoint: "https://attacker.example/revoke",
      },
      {
        issuer: "https://auth.openai.com",
        revocation_endpoint: "http://auth.openai.com/revoke",
      },
      {
        issuer: "https://auth.openai.com",
        revocation_endpoint: "https://auth.openai.com@attacker.example/revoke",
      },
      {
        issuer: "https://issuer.example.test",
        revocation_endpoint: "https://auth.openai.com/revoke",
      },
    ]) {
      expect(() =>
        parseChatGPTSubscriptionRevocationEndpoint(metadata),
      ).toThrow();
    }
  });

  it("verifies signature, issuer, client audience, expiry, and nonce", async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair("RS256");
    const { privateKey: attackerKey } = await jose.generateKeyPair("RS256");
    const keySet = jose.createLocalJWKSet({
      keys: [
        {
          ...(await jose.exportJWK(publicKey)),
          alg: "RS256",
          kid: "test-key",
          use: "sig",
        },
      ],
    });
    const createIdToken = async (claims: {
      issuer?: string;
      audience?: string | string[];
      nonce?: string;
      expiresAt?: number;
      email?: unknown;
    }) =>
      new jose.SignJWT({
        nonce: claims.nonce ?? NONCE,
        email: claims.email === undefined ? "a@example.test" : claims.email,
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(claims.issuer ?? "https://auth.openai.com")
        .setAudience(claims.audience ?? CLIENT_ID)
        .setSubject("verified-subject")
        .setIssuedAt()
        .setExpirationTime(claims.expiresAt ?? "1h")
        .sign(privateKey);

    const token = await createIdToken({});
    await expect(
      verifyChatGPTSubscriptionIdToken(token, CLIENT_ID, NONCE, keySet),
    ).resolves.toMatchObject({
      subject: "verified-subject",
      email: "a@example.test",
    });

    await expect(
      verifyChatGPTSubscriptionIdToken(
        token,
        "oaiapp_other-client",
        NONCE,
        keySet,
      ),
    ).rejects.toThrow();
    await expect(
      verifyChatGPTSubscriptionIdToken(
        token,
        CLIENT_ID,
        "different-nonce",
        keySet,
      ),
    ).rejects.toThrow("nonce does not match");

    const wrongIssuer = await createIdToken({
      issuer: "https://issuer.example.test",
    });
    await expect(
      verifyChatGPTSubscriptionIdToken(wrongIssuer, CLIENT_ID, NONCE, keySet),
    ).rejects.toThrow();

    const expired = await createIdToken({ expiresAt: 1 });
    await expect(
      verifyChatGPTSubscriptionIdToken(expired, CLIENT_ID, NONCE, keySet),
    ).rejects.toThrow();

    const invalidEmailClaim = await createIdToken({ email: 42 });
    await expect(
      verifyChatGPTSubscriptionIdToken(
        invalidEmailClaim,
        CLIENT_ID,
        NONCE,
        keySet,
      ),
    ).rejects.toThrow("invalid email claim");

    const forged = await new jose.SignJWT({ nonce: NONCE })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://auth.openai.com")
      .setAudience(CLIENT_ID)
      .setSubject("attacker-subject")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(attackerKey);
    await expect(
      verifyChatGPTSubscriptionIdToken(forged, CLIENT_ID, NONCE, keySet),
    ).rejects.toThrow();
  });
});

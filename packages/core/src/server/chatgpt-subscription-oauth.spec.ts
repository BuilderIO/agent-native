import * as jose from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHATGPT_SUBSCRIPTION_LAB } from "../labs/core-labs.js";
import { _resetLabRegistryForTests, registerLabs } from "../labs/registry.js";

const mocks = vi.hoisted(() => ({
  getUserLabEnabled: vi.fn(),
}));

vi.mock("../labs/store.js", () => mocks);

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
  _resetLabRegistryForTests();
  registerLabs([CHATGPT_SUBSCRIPTION_LAB]);
});

describe("ChatGPT subscription OAuth contract", () => {
  it("keeps ChatGPT credentials unavailable until the lab is enabled", async () => {
    await runWithRequestContext(
      {
        isLoopbackRequest: true,
        requestOrigin: "http://127.0.0.1:1455",
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

  it("surfaces lab preference read failures instead of treating them as off", async () => {
    const error = new Error("settings unavailable");
    mocks.getUserLabEnabled.mockRejectedValue(error);

    await runWithRequestContext(
      {
        isLoopbackRequest: true,
        requestOrigin: "http://127.0.0.1:1455",
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
        requestOrigin: "http://127.0.0.1:1455",
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

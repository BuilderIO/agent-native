import { describe, expect, it, vi } from "vitest";

import {
  SLACK_AUTH_TEST_URL,
  SLACK_TOKEN_URL,
  assertSlackInstallAccess,
  buildSlackAuthorizeUrl,
  exchangeSlackOAuthCode,
  refreshSlackOAuthToken,
  slackInstallationKey,
  slackOAuthResponseToInstallation,
  testSlackAuth,
} from "./slack-oauth.js";

describe("Slack managed-install OAuth helpers", () => {
  it("builds an OAuth v2 authorization URL with contextual bot scopes", () => {
    const url = new URL(
      buildSlackAuthorizeUrl({
        clientId: "client-example",
        redirectUri: "https://app.example.com/slack/callback",
        state: "signed-state",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://slack.com/oauth/v2/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-example");
    expect(url.searchParams.get("scope")).toContain("chat:write");
    expect(url.searchParams.get("scope")).toContain("assistant:write");
    expect(url.searchParams.get("scope")).toContain("files:read");
    expect(url.searchParams.get("scope")).toContain("channels:read");
    expect(url.searchParams.get("scope")).toContain("groups:read");
    expect(url.searchParams.get("scope")).toContain("mpim:read");
    expect(url.searchParams.get("scope")).toContain("pins:read");
    expect(url.searchParams.get("scope")).toContain("reactions:read");
    expect(url.searchParams.get("scope")).toContain("users:read.email");
  });

  it("exchanges codes with Basic auth and keeps credentials out of the body", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            access_token: "xoxb-example-not-real",
            team: { id: "T123" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    await exchangeSlackOAuthCode({
      code: "code-example",
      clientId: "client-example",
      clientSecret: "secret-example",
      redirectUri: "https://app.example.com/slack/callback",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      SLACK_TOKEN_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("client-example:secret-example").toString("base64")}`,
        }),
      }),
    );
    const request = fetchImpl.mock.calls[0][1] as RequestInit;
    const body = String(request.body);
    expect(body).toContain("code=code-example");
    expect(body).not.toContain("client-example");
    expect(body).not.toContain("secret-example");
  });

  it("reports auth.test health without returning or leaking the token", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            team_id: "T123",
            enterprise_id: "E123",
            bot_id: "B123",
            user_id: "U123",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const health = await testSlackAuth(
      "xoxb-example-not-real",
      fetchImpl as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      SLACK_AUTH_TEST_URL,
      expect.objectContaining({
        headers: { Authorization: "Bearer xoxb-example-not-real" },
      }),
    );
    expect(health).toMatchObject({
      ok: true,
      health: "healthy",
      teamId: "T123",
      enterpriseId: "E123",
    });
    expect(JSON.stringify(health)).not.toContain("xoxb-example-not-real");
  });

  it("rotates access and one-time refresh tokens as one bundle", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            access_token: "xoxb-example-rotated",
            refresh_token: "xoxe-example-next",
            expires_in: 43_200,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const result = await refreshSlackOAuthToken({
      refreshToken: "xoxe-example-current",
      clientId: "client-example",
      clientSecret: "secret-example",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({
      access_token: "xoxb-example-rotated",
      refresh_token: "xoxe-example-next",
    });
    const request = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(String(request.body)).toBe(
      "grant_type=refresh_token&refresh_token=xoxe-example-current",
    );
    expect(String(request.body)).not.toContain("secret-example");
  });

  it("classifies revoked Slack credentials", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: "token_revoked" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(
      testSlackAuth("xoxb-example-not-real", fetchImpl as typeof fetch),
    ).resolves.toMatchObject({
      ok: false,
      health: "revoked",
      error: "token_revoked",
    });
  });

  it("derives team and enterprise installation keys", () => {
    expect(slackInstallationKey({ teamId: "T123", apiAppId: "A123" })).toBe(
      "team:T123:app:A123",
    );
    expect(
      slackInstallationKey({
        teamId: null,
        enterpriseId: "E123",
        apiAppId: "A123",
        isEnterpriseInstall: true,
      }),
    ).toBe("enterprise:E123:app:A123");
  });

  it("maps token rotation metadata into the encrypted-store input", () => {
    const input = slackOAuthResponseToInstallation(
      {
        ok: true,
        access_token: "xoxb-example-not-real",
        refresh_token: "xoxe-example-not-real",
        expires_in: 3600,
        token_type: "bot",
        scope: "chat:write,files:read",
        app_id: "A123",
        bot_user_id: "U-BOT",
        team: { id: "T123", name: "Example" },
      },
      {
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        secretScope: "org",
        secretScopeId: "org-1",
      },
      1_000,
    );

    expect(input).toMatchObject({
      installationKey: "team:T123:app:A123",
      scopes: ["chat:write", "files:read"],
      tokenExpiresAt: 3_601_000,
      tokenBundle: {
        accessToken: "xoxb-example-not-real",
        refreshToken: "xoxe-example-not-real",
        expiresAt: 3_601_000,
      },
    });
  });

  it("requires an active session and org admin role", () => {
    expect(() => assertSlackInstallAccess(null)).toThrow("Sign in");
    expect(() =>
      assertSlackInstallAccess({
        email: "member@example.com",
        orgId: "org-1",
        orgRole: "member",
      }),
    ).toThrow("owners and admins");
    expect(
      assertSlackInstallAccess({
        email: "ADMIN@EXAMPLE.COM",
        orgId: "org-1",
        orgRole: "admin",
      }),
    ).toEqual({
      ownerEmail: "admin@example.com",
      orgId: "org-1",
      secretScope: "org",
      secretScopeId: "org-1",
    });
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  encodeOAuthState: vi.fn(),
  getSession: vi.fn(),
  isElectron: vi.fn(() => false),
  oauthCallbackResponse: vi.fn(),
  oauthErrorPage: vi.fn((message: string) => new Response(message)),
  resolveOAuthRedirectUri: vi.fn(),
  safeReturnPath: vi.fn((value: string | undefined) => value || "/"),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  runWithRequestContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));

vi.mock("@agent-native/core/secrets", () => ({
  deleteAppSecret: vi.fn(),
  readAppSecret: vi.fn(),
  writeAppSecret: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
  schema: { slackInstallations: {} },
}));

vi.mock("./recordings.js", () => ({
  getActiveOrganizationId: vi.fn(),
  getOrganizationRoleForEmail: vi.fn(),
}));

import {
  buildSlackAuthorizeUrl,
  exchangeSlackOAuthCode,
  isSlackConnectState,
  slackInstallationBotTokenKey,
  SLACK_TOKEN_URL,
  SLACK_UNFURL_SCOPES,
  CLIPS_SLACK_OAUTH_APP_ID,
} from "./slack-oauth";

describe("Clips Slack OAuth", () => {
  it("builds Slack authorize URLs with app unfurl scopes", () => {
    const url = new URL(
      buildSlackAuthorizeUrl({
        clientId: "client-id",
        redirectUri: "https://clips.example.com/api/slack/oauth/callback",
        state: "signed-state",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://slack.com/oauth/v2/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://clips.example.com/api/slack/oauth/callback",
    );
    expect(url.searchParams.get("scope")).toBe(SLACK_UNFURL_SCOPES.join(","));
    expect(url.searchParams.get("state")).toBe("signed-state");
  });

  it("recognizes signed Clips Slack install state", () => {
    expect(
      isSlackConnectState({
        app: CLIPS_SLACK_OAUTH_APP_ID,
        addAccount: true,
        redirectUri: "https://clips.example.com/api/slack/oauth/callback",
      }),
    ).toBe(true);
    expect(
      isSlackConnectState({
        app: "clips",
        addAccount: true,
        redirectUri: "https://clips.example.com/api/slack/oauth/callback",
      }),
    ).toBe(false);
  });

  it("uses deterministic bot token secret keys per Slack app and team", () => {
    expect(slackInstallationBotTokenKey("T123", "A123")).toBe(
      "clips-slack:A123:T123:bot-token",
    );
    expect(slackInstallationBotTokenKey("T123")).toBe(
      "clips-slack:default:T123:bot-token",
    );
  });

  it("exchanges Slack OAuth codes with the configured redirect URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          access_token: "example-bot-token",
          team: { id: "T123", name: "Example" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      exchangeSlackOAuthCode({
        code: "temporary-code",
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "https://clips.example.com/api/slack/oauth/callback",
        fetchImpl: fetchImpl as any,
      }),
    ).resolves.toMatchObject({
      ok: true,
      access_token: "example-bot-token",
      team: { id: "T123" },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      SLACK_TOKEN_URL,
      expect.objectContaining({ method: "POST" }),
    );
    const body = (fetchImpl.mock.calls[0]?.[1]?.body ??
      new URLSearchParams()) as URLSearchParams;
    expect(body.get("code")).toBe("temporary-code");
    expect(body.get("redirect_uri")).toBe(
      "https://clips.example.com/api/slack/oauth/callback",
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorization: "Bearer signed-connector-token-example",
  authenticateRequest: vi.fn(),
}));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    getHeader: vi.fn((_event: unknown, name: string) =>
      name.toLowerCase() === "authorization" ? state.authorization : undefined,
    ),
    readRawBody: vi.fn(async (event: any) => event.context.__rawBody),
  };
});

vi.mock("botframework-connector", () => ({
  JwtTokenValidation: {
    authenticateRequest: state.authenticateRequest,
  },
  SimpleCredentialProvider: class {
    constructor(
      readonly appId: string,
      readonly appPassword: string,
    ) {}
  },
}));

import {
  clearMicrosoftTeamsAccessTokenCache,
  getMicrosoftTeamsAccessToken,
  microsoftTeamsAdapter,
} from "./microsoft-teams.js";

function eventWithActivity(activity: unknown): any {
  return { context: { __rawBody: JSON.stringify(activity) } };
}

function messageActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: "activity-example",
    type: "message",
    timestamp: "2026-07-10T12:00:00.000Z",
    serviceUrl: "https://smba.trafficmanager.net/amer/",
    channelId: "msteams",
    text: "<at>Example Bot</at> ship it",
    from: {
      id: "teams-user-example",
      aadObjectId: "entra-user-example",
      name: "Example User",
    },
    recipient: { id: "bot-example", name: "Example Bot" },
    conversation: {
      id: "conversation-example",
      tenantId: "tenant-example",
      conversationType: "channel",
    },
    channelData: {
      tenant: { id: "tenant-example" },
      team: { id: "team-example", name: "Example Team" },
      channel: { id: "channel-example", name: "Example Channel" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  clearMicrosoftTeamsAccessTokenCache();
  state.authenticateRequest.mockReset().mockResolvedValue({});
  state.authorization = "Bearer signed-connector-token-example";
  vi.stubEnv("MICROSOFT_TEAMS_APP_ID", "app-id-example");
  vi.stubEnv("MICROSOFT_TEAMS_APP_PASSWORD", "client-secret-example");
  vi.stubEnv("MICROSOFT_TEAMS_ALLOWED_TENANT_IDS", "tenant-example");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("microsoftTeamsAdapter", () => {
  it("uses the official Bot Framework verifier and rejects failed JWT validation", async () => {
    const event = eventWithActivity(messageActivity());

    await expect(microsoftTeamsAdapter().verifyWebhook(event)).resolves.toBe(
      true,
    );
    expect(state.authenticateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "msteams",
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      }),
      "Bearer signed-connector-token-example",
      expect.objectContaining({
        appId: "app-id-example",
        appPassword: "client-secret-example",
      }),
      "",
    );

    state.authenticateRequest.mockRejectedValueOnce(new Error("invalid"));
    await expect(microsoftTeamsAdapter().verifyWebhook(event)).resolves.toBe(
      false,
    );
  });

  it("fails closed for a Teams tenant outside the allowlist", async () => {
    await expect(
      microsoftTeamsAdapter().verifyWebhook(
        eventWithActivity(
          messageActivity({
            channelData: { tenant: { id: "other-tenant-example" } },
          }),
        ),
      ),
    ).resolves.toBe(false);
  });

  it("normalizes tenant, team, channel, conversation, and reply identity", async () => {
    const incoming = await microsoftTeamsAdapter().parseIncomingMessage(
      eventWithActivity(messageActivity()),
    );

    expect(incoming).toMatchObject({
      platform: "microsoft-teams",
      externalThreadId:
        "tenant:tenant-example:team:team-example:channel:channel-example:conversation:conversation-example",
      text: "ship it",
      senderId: "entra-user-example",
      threadRef: "conversation-example",
      replyRef: "activity-example",
      platformContext: {
        tenantId: "tenant-example",
        teamId: "team-example",
        channelId: "channel-example",
        conversationId: "conversation-example",
        serviceUrl: "https://smba.trafficmanager.net/amer",
      },
    });
  });

  it("obtains and caches Bot Framework access tokens", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "access-token-example",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMicrosoftTeamsAccessToken()).resolves.toBe(
      "access-token-example",
    );
    await expect(getMicrosoftTeamsAccessToken()).resolves.toBe(
      "access-token-example",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token",
    );
    const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("scope")).toBe("https://api.botframework.com/.default");
  });

  it("refreshes tokens inside the expiry skew and replies to the signed service URL", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("/oauth2/v2.0/token")) {
          return new Response(
            JSON.stringify({
              access_token: `access-token-example-${calls.length}`,
              expires_in: 1,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ id: "reply-example" }), {
          status: 200,
        });
      }),
    );

    await getMicrosoftTeamsAccessToken();
    await getMicrosoftTeamsAccessToken();
    expect(
      calls.filter((call) => call.url.includes("/oauth2/v2.0/token")),
    ).toHaveLength(2);

    const incoming = await microsoftTeamsAdapter().parseIncomingMessage(
      eventWithActivity(messageActivity()),
    );
    await microsoftTeamsAdapter().sendResponse(
      { text: "Done", platformContext: {} },
      incoming!,
    );

    const reply = calls.find((call) => call.url.includes("/v3/conversations/"));
    expect(reply?.url).toBe(
      "https://smba.trafficmanager.net/amer/v3/conversations/conversation-example/activities/activity-example",
    );
    expect(reply?.init?.headers).toEqual(
      expect.objectContaining({
        Authorization: expect.stringMatching(/^Bearer access-token-example-/),
      }),
    );
    expect(JSON.parse(String(reply?.init?.body))).toMatchObject({
      type: "message",
      text: "Done",
      replyToId: "activity-example",
      channelId: "msteams",
      serviceUrl: "https://smba.trafficmanager.net/amer",
      conversation: { id: "conversation-example" },
    });
  });
});

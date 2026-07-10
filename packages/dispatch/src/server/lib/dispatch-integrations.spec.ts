import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeLinkToken: vi.fn(),
  resolveLinkedOwner: vi.fn(),
  resolveOrgIdForEmail: vi.fn(),
  resolveSecret: vi.fn(),
}));

vi.mock("./dispatch-store.js", () => ({
  consumeLinkToken: mocks.consumeLinkToken,
  resolveLinkedOwner: mocks.resolveLinkedOwner,
}));

vi.mock("@agent-native/core/org", () => ({
  resolveOrgIdForEmail: mocks.resolveOrgIdForEmail,
}));

vi.mock("@agent-native/core/server", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/server")
  >("@agent-native/core/server");
  return {
    ...actual,
    resolveSecret: mocks.resolveSecret,
  };
});

import type {
  IncomingMessage,
  PlatformAdapter,
} from "@agent-native/core/server";

import {
  beforeDispatchProcess,
  identityKeyForIncoming,
  resolveDispatchOwner,
  resolveDispatchExecutionContext,
} from "./dispatch-integrations.js";

const originalFetch = globalThis.fetch;

function slackIncoming(
  overrides: Partial<IncomingMessage> = {},
): IncomingMessage {
  return {
    platform: "slack",
    externalThreadId: "C1:123.456",
    text: "make a deck",
    senderId: "U123",
    senderName: "U123",
    platformContext: { teamId: "T123", channelId: "C1" },
    timestamp: 1,
    ...overrides,
  };
}

function emailIncoming(
  overrides: Partial<IncomingMessage> = {},
): IncomingMessage {
  return {
    platform: "email",
    externalThreadId: "victim@member.test::<root@member.test>",
    text: "transfer everything",
    senderId: "victim@member.test",
    senderName: "Victim",
    platformContext: { from: "victim@member.test" },
    timestamp: 1,
    ...overrides,
  };
}

function telegramIncoming(
  overrides: Partial<IncomingMessage> = {},
): IncomingMessage {
  return {
    platform: "telegram",
    externalThreadId: "12345",
    text: "ask analytics about traffic",
    senderId: "777",
    senderName: "Steve",
    platformContext: { chatId: 12345, fromId: 777, rawText: "hello" },
    timestamp: 1,
    ...overrides,
  };
}

const noopAdapter: PlatformAdapter = {
  platform: "telegram",
  label: "Telegram",
  getRequiredEnvKeys: () => [],
  handleVerification: async () => ({ handled: false }),
  verifyWebhook: async () => true,
  parseIncomingMessage: async () => null,
  sendResponse: async () => {},
  formatAgentResponse: (text: string) => ({ text, platformContext: {} }),
  getStatus: async () => ({
    platform: "telegram",
    label: "Telegram",
    enabled: true,
    configured: true,
  }),
};

beforeEach(() => {
  mocks.resolveLinkedOwner.mockResolvedValue(null);
  mocks.consumeLinkToken.mockResolvedValue("owner@example.test");
  mocks.resolveOrgIdForEmail.mockResolvedValue(null);
  mocks.resolveSecret.mockImplementation(
    async (key: string) => process.env[key] ?? null,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: false }))),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("identityKeyForIncoming", () => {
  it("scopes Slack identities by team", () => {
    expect(identityKeyForIncoming(slackIncoming())).toBe("T123:U123");
  });

  it("uses Telegram sender ids as link identities", () => {
    expect(identityKeyForIncoming(telegramIncoming())).toBe("777");
  });
});

describe("resolveDispatchOwner", () => {
  it("uses a linked identity before Slack email lookup", async () => {
    mocks.resolveLinkedOwner.mockResolvedValueOnce("linked@example.test");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-token");

    await expect(resolveDispatchOwner(slackIncoming())).resolves.toBe(
      "linked@example.test",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses the verified Slack email for org members", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-token");
    mocks.resolveSecret.mockResolvedValueOnce(null);
    mocks.resolveOrgIdForEmail.mockResolvedValueOnce("org_123");
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: {
            real_name: "Slack User",
            profile: { email: "USER@EXAMPLE.TEST", display_name: "User" },
          },
        }),
      ),
    );

    const incoming = slackIncoming();

    await expect(resolveDispatchOwner(incoming)).resolves.toBe(
      "user@example.test",
    );
    expect(incoming.senderEmail).toBe("user@example.test");
    expect(incoming.senderName).toBe("User");
    expect(incoming.platformContext.senderEmail).toBe("user@example.test");
  });

  it("uses the request-scoped Slack token when no env token exists", async () => {
    mocks.resolveSecret.mockResolvedValueOnce("configured-slack-token");
    mocks.resolveOrgIdForEmail.mockResolvedValueOnce("org_123");
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: {
            profile: { email: "member@example.test", display_name: "Member" },
          },
        }),
      ),
    );

    await expect(
      resolveDispatchOwner(
        slackIncoming({
          senderId: "U999",
          platformContext: { teamId: "T999", channelId: "C1" },
        }),
      ),
    ).resolves.toBe("member@example.test");
    expect(mocks.resolveSecret).toHaveBeenCalledWith("SLACK_BOT_TOKEN");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://slack.com/api/users.info?user=U999",
      {
        headers: { Authorization: "Bearer configured-slack-token" },
      },
    );
  });

  it("falls back to the configured Slack owner when the sender is not an org member", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-token");
    vi.stubEnv("DISPATCH_DEFAULT_OWNER_EMAIL", "default@example.test");
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: { profile: { email: "guest@example.test" } },
        }),
      ),
    );

    await expect(resolveDispatchOwner(slackIncoming())).resolves.toBe(
      "default@example.test",
    );
  });

  it("does NOT impersonate an org member from an unverified (spoofed) email From", async () => {
    // Attacker spoofs From: victim@member.test, which IS a real org member —
    // but the message is unverified (no DKIM/SPF pass). Must fall through to
    // the synthetic, credential-less owner, NOT the victim's identity.
    mocks.resolveOrgIdForEmail.mockResolvedValue("org_123");

    const owner = await resolveDispatchOwner(
      emailIncoming({ senderVerified: false }),
    );

    expect(owner).not.toBe("victim@member.test");
    expect(owner).toMatch(/@integration\.local$/);
  });

  it("does NOT impersonate when sender is verified but not an org member", async () => {
    mocks.resolveOrgIdForEmail.mockResolvedValue(null);

    const owner = await resolveDispatchOwner(
      emailIncoming({
        senderId: "stranger@outside.test",
        platformContext: { from: "stranger@outside.test" },
        senderVerified: true,
      }),
    );

    expect(owner).not.toBe("stranger@outside.test");
    expect(owner).toMatch(/@integration\.local$/);
  });

  it("uses the email sender as owner when verified AND an org member", async () => {
    mocks.resolveOrgIdForEmail.mockResolvedValue("org_123");

    await expect(
      resolveDispatchOwner(emailIncoming({ senderVerified: true })),
    ).resolves.toBe("victim@member.test");
  });

  it("honors a linked identity for email regardless of verification", async () => {
    mocks.resolveLinkedOwner.mockResolvedValueOnce("linked@member.test");

    await expect(
      resolveDispatchOwner(emailIncoming({ senderVerified: false })),
    ).resolves.toBe("linked@member.test");
    expect(mocks.resolveOrgIdForEmail).not.toHaveBeenCalled();
  });

  it("restores legacy trust-From behavior under the escape hatch", async () => {
    vi.stubEnv("DISPATCH_TRUST_UNVERIFIED_EMAIL_SENDER", "1");

    await expect(
      resolveDispatchOwner(emailIncoming({ senderVerified: false })),
    ).resolves.toBe("victim@member.test");
  });
});

describe("beforeDispatchProcess", () => {
  it("attaches capability-based guidance for structured intake", async () => {
    const incoming = slackIncoming({
      text: "File this review request using our intake form",
    });

    await expect(beforeDispatchProcess(incoming, noopAdapter)).resolves.toEqual(
      { handled: false },
    );
    expect((incoming as any).routingHint.targetAgent).toBeUndefined();
    expect((incoming as any).routingHint.instruction).toContain(
      "workspace instructions/resources",
    );
  });

  it("asks unlinked Telegram users to link before using org context", async () => {
    vi.stubEnv("APP_URL", "https://dispatch.agent-native.test");

    const result = await beforeDispatchProcess(telegramIncoming(), noopAdapter);

    expect(result).toEqual({
      handled: true,
      responseText:
        "Telegram is connected, but this Telegram account is not linked to an Agent-Native user yet. Tap https://dispatch.agent-native.test/identities, create a Telegram link token, then send `/link <token>` here. After that I can use your Builder.io org and connected apps.",
    });
    expect(mocks.resolveLinkedOwner).toHaveBeenCalledWith("telegram", "777", {
      allowAnyOrgFallback: true,
    });
  });

  it("lets linked Telegram users proceed to normal agent processing", async () => {
    mocks.resolveLinkedOwner.mockResolvedValueOnce("steve@builder.io");

    await expect(
      beforeDispatchProcess(telegramIncoming(), noopAdapter),
    ).resolves.toEqual({ handled: false });
  });

  it("still consumes Telegram link commands before enforcing the link gate", async () => {
    const result = await beforeDispatchProcess(
      telegramIncoming({
        text: "token-123",
        platformContext: {
          chatId: 12345,
          fromId: 777,
          rawText: "/link token-123",
        },
      }),
      noopAdapter,
    );

    expect(result).toEqual({
      handled: true,
      responseText:
        "Linked successfully. Future telegram messages will use owner@example.test's personal dispatch context.",
    });
    expect(mocks.consumeLinkToken).toHaveBeenCalledWith({
      platform: "telegram",
      token: "token-123",
      externalUserId: "777",
      externalUserName: "Steve",
    });
  });

  it("replies with linking guidance instead of silently dropping an unlinked Slack DM", async () => {
    vi.stubEnv("APP_URL", "https://dispatch.agent-native.test");
    const incoming = slackIncoming({
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        teamId: "T123",
        channelId: "D123",
        channelType: "im",
      },
    });

    const execution = await resolveDispatchExecutionContext(incoming);
    const result = await beforeDispatchProcess(incoming, noopAdapter);

    expect(execution.ownerEmail).toMatch(/@integration\.local$/);
    expect(incoming.platformContext.identityLinkRequired).toBe(true);
    expect(result).toEqual({
      handled: true,
      responseText:
        "Agent Native is ready, but this Slack account is not linked to an Agent Native user yet. Open https://dispatch.agent-native.test/identities, create a Slack link token, then send `/link <token>` in this DM.",
    });
  });

  it("lets an unlinked Slack DM consume a link token before the agent gate", async () => {
    const incoming = slackIncoming({
      text: "/link token-123",
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        teamId: "T123",
        channelId: "D123",
        channelType: "im",
      },
    });

    await resolveDispatchExecutionContext(incoming);
    const result = await beforeDispatchProcess(incoming, noopAdapter);

    expect(result).toEqual({
      handled: true,
      responseText:
        "Linked successfully. Future slack messages will use owner@example.test's personal dispatch context.",
    });
    expect(mocks.consumeLinkToken).toHaveBeenCalledWith({
      platform: "slack",
      token: "token-123",
      externalUserId: "T123:U123",
      externalUserName: "U123",
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeLinkToken: vi.fn(),
  evaluateIntegrationScopePolicy: vi.fn(),
  getActiveIntegrationInstallationByKey: vi.fn(),
  getIntegrationScope: vi.fn(),
  isOrgMember: vi.fn(),
  resolveLinkedOwner: vi.fn(),
  resolveOrgIdForEmail: vi.fn(),
  resolveSecret: vi.fn(),
  resolveSlackBotTokenForIncoming: vi.fn(),
}));

vi.mock("./dispatch-store.js", () => ({
  consumeLinkToken: mocks.consumeLinkToken,
  resolveLinkedOwner: mocks.resolveLinkedOwner,
}));

vi.mock("@agent-native/core/integrations", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/integrations")
  >("@agent-native/core/integrations");
  return {
    ...actual,
    getActiveIntegrationInstallationByKey:
      mocks.getActiveIntegrationInstallationByKey,
    evaluateIntegrationScopePolicy: mocks.evaluateIntegrationScopePolicy,
    getIntegrationScope: mocks.getIntegrationScope,
    resolveSlackBotTokenForIncoming: mocks.resolveSlackBotTokenForIncoming,
  };
});

vi.mock("@agent-native/core/org", () => ({
  isOrgMember: mocks.isOrgMember,
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
  mocks.getActiveIntegrationInstallationByKey.mockResolvedValue(null);
  mocks.getIntegrationScope.mockResolvedValue(null);
  mocks.evaluateIntegrationScopePolicy.mockReturnValue({ allowed: true });
  mocks.isOrgMember.mockResolvedValue(false);
  mocks.resolveLinkedOwner.mockResolvedValue(null);
  mocks.consumeLinkToken.mockResolvedValue("owner@example.test");
  mocks.resolveOrgIdForEmail.mockResolvedValue(null);
  mocks.resolveSlackBotTokenForIncoming.mockResolvedValue(null);
  mocks.resolveSecret.mockImplementation(
    async (key: string) => process.env[key] ?? null,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: false }))),
  );
});

function managedSlackInstallation(overrides: Record<string, unknown> = {}) {
  return {
    id: "installation-managed",
    installationKey: "T-MANAGED",
    ownerEmail: "installer@example.test",
    orgId: "org-managed",
    ...overrides,
  };
}

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
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce("xoxb-token");
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
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce(
      "configured-slack-token",
    );
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
    expect(mocks.resolveSlackBotTokenForIncoming).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: "U999" }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://slack.com/api/users.info?user=U999",
      {
        headers: { Authorization: "Bearer configured-slack-token" },
      },
    );
  });

  it("does not resolve a sender with a legacy token from another Slack app", async () => {
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce(null);

    const incoming = slackIncoming({
      platformContext: {
        teamId: "T123",
        apiAppId: "A123",
        channelId: "C1",
      },
    });

    const owner = await resolveDispatchOwner(incoming);

    expect(owner).toMatch(/@integration\.local$/);
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      "https://slack.com/api/users.info?user=U123",
      expect.anything(),
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

  it("scopes a managed Slack link claim to the installation organization", async () => {
    mocks.getActiveIntegrationInstallationByKey.mockResolvedValueOnce(
      managedSlackInstallation(),
    );
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce(
      "managed-token",
    );
    mocks.consumeLinkToken.mockRejectedValueOnce(
      new Error(
        "This link token belongs to a different organization. Create a token from this workspace and try again.",
      ),
    );
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: { profile: { email: "outside@example.test" } },
        }),
      ),
    );
    const incoming = slackIncoming({
      text: "/link token-other-org",
      senderId: "U-MANAGED-LINK",
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        teamId: "T-MANAGED",
        channelId: "D-MANAGED",
        channelType: "im",
      },
    });

    await resolveDispatchExecutionContext(incoming);
    await expect(beforeDispatchProcess(incoming, noopAdapter)).resolves.toEqual(
      {
        handled: true,
        responseText:
          "This link token belongs to a different organization. Create a token from this workspace and try again.",
      },
    );
    expect(mocks.consumeLinkToken).toHaveBeenCalledWith({
      platform: "slack",
      token: "token-other-org",
      externalUserId: "T-MANAGED:U-MANAGED-LINK",
      externalUserName: "U123",
      expectedOrgId: "org-managed",
    });
  });

  it("does not consume a managed Slack link token when identity verification fails", async () => {
    mocks.getActiveIntegrationInstallationByKey.mockResolvedValueOnce(
      managedSlackInstallation(),
    );
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce(
      "managed-token",
    );
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false })),
    );
    const incoming = slackIncoming({
      text: "/link token-unverified",
      senderId: "U-MANAGED-UNVERIFIED",
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        teamId: "T-MANAGED",
        channelId: "D-MANAGED",
        channelType: "im",
      },
    });

    await resolveDispatchExecutionContext(incoming);
    await expect(beforeDispatchProcess(incoming, noopAdapter)).resolves.toEqual(
      {
        handled: true,
        responseText:
          "I couldn't verify your Slack identity just now, so I can't run this request. Please try again in a moment.",
      },
    );
    expect(mocks.consumeLinkToken).not.toHaveBeenCalled();
  });
});

describe("managed Slack execution identity", () => {
  it("uses the enterprise-scoped installation for an Enterprise Grid DM", async () => {
    mocks.getActiveIntegrationInstallationByKey.mockResolvedValueOnce(
      managedSlackInstallation(),
    );
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce(
      "managed-token",
    );
    mocks.isOrgMember.mockResolvedValueOnce(true);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: { profile: { email: "alice@example.test" } },
        }),
      ),
    );

    await resolveDispatchExecutionContext(
      slackIncoming({
        senderId: "U-ENTERPRISE-ALICE",
        triggerKind: "dm",
        conversationType: "dm",
        platformContext: {
          teamId: "T-ENTERPRISE-WORKSPACE",
          enterpriseId: "E-MANAGED",
          isEnterpriseInstall: true,
          apiAppId: "A-MANAGED",
          channelId: "D-MANAGED",
          channelType: "im",
        },
      }),
    );

    expect(mocks.getActiveIntegrationInstallationByKey).toHaveBeenCalledWith(
      "slack",
      "enterprise:E-MANAGED:app:A-MANAGED",
    );
  });

  it("fails closed with retry guidance when managed installation lookup is unavailable", async () => {
    vi.stubEnv("DISPATCH_DEFAULT_OWNER_EMAIL", "deployment-owner@example.test");
    mocks.getActiveIntegrationInstallationByKey.mockRejectedValueOnce(
      new Error("installation store unavailable"),
    );
    const incoming = slackIncoming({
      senderId: "U-MANAGED-ALICE",
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        teamId: "T-MANAGED",
        channelId: "D-MANAGED",
        channelType: "im",
      },
    });

    const execution = await resolveDispatchExecutionContext(incoming);

    expect(execution.ownerEmail).toMatch(/@integration\.local$/);
    expect(execution.ownerEmail).not.toBe("deployment-owner@example.test");
    expect(execution.orgId).toBeNull();
    await expect(beforeDispatchProcess(incoming, noopAdapter)).resolves.toEqual(
      {
        handled: true,
        responseText:
          "I couldn't verify your Slack identity just now, so I can't run this request. Please try again in a moment.",
      },
    );
  });

  it("fails closed with retry guidance when linked identity lookup is unavailable", async () => {
    vi.stubEnv("DISPATCH_DEFAULT_OWNER_EMAIL", "deployment-owner@example.test");
    mocks.getActiveIntegrationInstallationByKey.mockResolvedValueOnce(
      managedSlackInstallation(),
    );
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce(
      "managed-token",
    );
    mocks.resolveLinkedOwner.mockRejectedValueOnce(
      new Error("identity link store unavailable"),
    );
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: { profile: { email: "alice@example.test" } },
        }),
      ),
    );
    const incoming = slackIncoming({
      senderId: "U-MANAGED-ALICE",
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        teamId: "T-MANAGED",
        channelId: "D-MANAGED",
        channelType: "im",
      },
    });

    const execution = await resolveDispatchExecutionContext(incoming);

    expect(execution.ownerEmail).toMatch(/@integration\.local$/);
    expect(execution.ownerEmail).not.toBe("deployment-owner@example.test");
    await expect(beforeDispatchProcess(incoming, noopAdapter)).resolves.toEqual(
      {
        handled: true,
        responseText:
          "I couldn't verify your Slack identity just now, so I can't run this request. Please try again in a moment.",
      },
    );
  });

  it("does not let a stale identity link override the verified Slack email", async () => {
    mocks.getActiveIntegrationInstallationByKey.mockResolvedValueOnce(
      managedSlackInstallation(),
    );
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce(
      "managed-token",
    );
    mocks.resolveLinkedOwner.mockResolvedValueOnce("stale@example.test");
    mocks.isOrgMember.mockImplementation(
      async (_orgId, email) => email === "current@example.test",
    );
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: { profile: { email: "current@example.test" } },
        }),
      ),
    );
    const incoming = slackIncoming({
      senderId: "U-MANAGED-MEMBER",
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        teamId: "T-MANAGED",
        channelId: "D-MANAGED",
        channelType: "im",
      },
    });

    await expect(
      resolveDispatchExecutionContext(incoming),
    ).resolves.toMatchObject({
      ownerEmail: "current@example.test",
      orgId: "org-managed",
      principalType: "user",
    });
    expect(mocks.isOrgMember).not.toHaveBeenCalledWith(
      "org-managed",
      "stale@example.test",
    );
  });

  it("does not borrow a user principal when managed channel installation lookup is unavailable", async () => {
    vi.stubEnv("DISPATCH_DEFAULT_OWNER_EMAIL", "deployment-owner@example.test");
    mocks.getActiveIntegrationInstallationByKey.mockRejectedValueOnce(
      new Error("installation store unavailable"),
    );

    await expect(
      resolveDispatchExecutionContext(
        slackIncoming({
          senderId: "U-MANAGED-ALICE",
          triggerKind: "mention",
          conversationType: "channel",
          platformContext: {
            teamId: "T-MANAGED",
            channelId: "C-MANAGED",
            channelType: "channel",
          },
        }),
      ),
    ).rejects.toThrow(
      "Managed Slack installation identity is temporarily unavailable",
    );
    expect(mocks.resolveLinkedOwner).not.toHaveBeenCalled();
  });

  it("uses the verified member in the installation org and ignores the deployment default", async () => {
    vi.stubEnv("DISPATCH_DEFAULT_OWNER_EMAIL", "deployment-owner@example.test");
    mocks.getActiveIntegrationInstallationByKey.mockResolvedValueOnce(
      managedSlackInstallation(),
    );
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce(
      "managed-token",
    );
    mocks.isOrgMember.mockResolvedValueOnce(true);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: {
            profile: {
              email: "ALICE@EXAMPLE.TEST",
              display_name: "Alice",
            },
          },
        }),
      ),
    );
    const incoming = slackIncoming({
      senderId: "U-MANAGED-ALICE",
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        teamId: "T-MANAGED",
        channelId: "D-MANAGED",
        channelType: "im",
      },
    });

    await expect(resolveDispatchExecutionContext(incoming)).resolves.toEqual({
      ownerEmail: "alice@example.test",
      orgId: "org-managed",
      principalType: "user",
      installationId: "installation-managed",
    });
    expect(mocks.isOrgMember).toHaveBeenCalledWith(
      "org-managed",
      "alice@example.test",
    );
    expect(incoming.senderVerified).toBe(true);
    expect(incoming.actorTrust).toEqual({
      memberType: "member",
      verified: true,
    });
  });

  it("fails closed instead of borrowing the deployment owner when Slack hydration fails", async () => {
    vi.stubEnv("DISPATCH_DEFAULT_OWNER_EMAIL", "deployment-owner@example.test");
    mocks.getActiveIntegrationInstallationByKey.mockResolvedValueOnce(
      managedSlackInstallation(),
    );
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce(
      "managed-token",
    );
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false })),
    );
    const incoming = slackIncoming({
      senderId: "U-MANAGED-UNKNOWN",
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        teamId: "T-MANAGED",
        channelId: "D-MANAGED",
        channelType: "im",
      },
    });

    const execution = await resolveDispatchExecutionContext(incoming);
    expect(execution.ownerEmail).toMatch(/@integration\.local$/);
    expect(execution.ownerEmail).not.toBe("deployment-owner@example.test");
    expect(execution.orgId).toBeNull();
    await expect(beforeDispatchProcess(incoming, noopAdapter)).resolves.toEqual(
      {
        handled: true,
        responseText:
          "I couldn't verify your Slack identity just now, so I can't run this request. Please try again in a moment.",
      },
    );
  });

  it("requires an explicit link when the verified identity is outside the installation org", async () => {
    vi.stubEnv("APP_URL", "https://dispatch.agent-native.test");
    vi.stubEnv("DISPATCH_DEFAULT_OWNER_EMAIL", "deployment-owner@example.test");
    mocks.getActiveIntegrationInstallationByKey.mockResolvedValueOnce(
      managedSlackInstallation(),
    );
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce(
      "managed-token",
    );
    mocks.isOrgMember.mockResolvedValueOnce(false);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: { profile: { email: "outside@example.test" } },
        }),
      ),
    );
    const incoming = slackIncoming({
      senderId: "U-MANAGED-OUTSIDE",
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        teamId: "T-MANAGED",
        channelId: "D-MANAGED",
        channelType: "im",
      },
    });

    const execution = await resolveDispatchExecutionContext(incoming);
    expect(execution.ownerEmail).toMatch(/@integration\.local$/);
    expect(execution.ownerEmail).not.toBe("deployment-owner@example.test");
    await expect(beforeDispatchProcess(incoming, noopAdapter)).resolves.toEqual(
      {
        handled: true,
        responseText:
          "Agent Native is ready, but this Slack account is not linked to an Agent Native user yet. Open https://dispatch.agent-native.test/identities, create a Slack link token, then send `/link <token>` in this DM.",
      },
    );
  });

  it("uses an explicitly linked in-org owner when the verified Slack email is outside the org", async () => {
    mocks.getActiveIntegrationInstallationByKey.mockResolvedValueOnce(
      managedSlackInstallation(),
    );
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValueOnce(
      "managed-token",
    );
    mocks.resolveLinkedOwner.mockResolvedValueOnce("member@example.test");
    mocks.isOrgMember.mockImplementation(
      async (_orgId, email) => email === "member@example.test",
    );
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          user: { profile: { email: "outside@example.test" } },
        }),
      ),
    );
    const incoming = slackIncoming({
      senderId: "U-MANAGED-LINKED",
      triggerKind: "dm",
      conversationType: "dm",
      platformContext: {
        teamId: "T-MANAGED",
        channelId: "D-MANAGED",
        channelType: "im",
      },
    });

    await expect(
      resolveDispatchExecutionContext(incoming),
    ).resolves.toMatchObject({
      ownerEmail: "member@example.test",
      orgId: "org-managed",
      principalType: "user",
    });
    expect(mocks.isOrgMember).toHaveBeenNthCalledWith(
      1,
      "org-managed",
      "outside@example.test",
    );
    expect(mocks.isOrgMember).toHaveBeenNthCalledWith(
      2,
      "org-managed",
      "member@example.test",
    );
  });

  it("keeps a managed channel on its service principal even when Alice is verified", async () => {
    mocks.getActiveIntegrationInstallationByKey.mockResolvedValueOnce(
      managedSlackInstallation(),
    );
    mocks.resolveSlackBotTokenForIncoming.mockResolvedValue("managed-token");
    mocks.getIntegrationScope.mockResolvedValueOnce({
      id: "scope-managed-channel",
      serviceOwnerEmail: "scope-managed-channel@integration.local",
      orgId: "org-managed",
      defaultModel: null,
    });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            user: {
              profile: {
                email: "alice@example.test",
                display_name: "Alice",
              },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, channel: { is_ext_shared: false } }),
        ),
      );

    const execution = await resolveDispatchExecutionContext(
      slackIncoming({
        senderId: "U-MANAGED-ALICE",
        triggerKind: "mention",
        conversationType: "channel",
        platformContext: {
          teamId: "T-MANAGED",
          channelId: "C-MANAGED",
          channelType: "channel",
        },
      }),
    );

    expect(execution).toEqual({
      ownerEmail: "scope-managed-channel@integration.local",
      orgId: "org-managed",
      principalType: "service",
      installationId: "installation-managed",
      scopeId: "scope-managed-channel",
    });
    expect(execution.ownerEmail).not.toBe("alice@example.test");
    expect(mocks.isOrgMember).not.toHaveBeenCalled();
  });
});

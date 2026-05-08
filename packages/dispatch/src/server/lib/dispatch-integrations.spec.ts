import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeLinkToken: vi.fn(),
  resolveLinkedOwner: vi.fn(),
  resolveOrgIdForEmail: vi.fn(),
}));

vi.mock("./dispatch-store.js", () => ({
  consumeLinkToken: mocks.consumeLinkToken,
  resolveLinkedOwner: mocks.resolveLinkedOwner,
}));

vi.mock("@agent-native/core/org", () => ({
  resolveOrgIdForEmail: mocks.resolveOrgIdForEmail,
}));

import {
  identityKeyForIncoming,
  resolveDispatchOwner,
} from "./dispatch-integrations.js";
import type { IncomingMessage } from "@agent-native/core/server";

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

beforeEach(() => {
  mocks.resolveLinkedOwner.mockResolvedValue(null);
  mocks.consumeLinkToken.mockResolvedValue("owner@example.test");
  mocks.resolveOrgIdForEmail.mockResolvedValue(null);
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
});

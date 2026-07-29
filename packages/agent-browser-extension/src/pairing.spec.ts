import { describe, expect, it } from "vitest";

import {
  acceptBrowserChatSession,
  BROWSER_CHAT_SESSION_MESSAGE_TYPE,
  MAX_SESSION_EXPIRY_MS,
  PAIRING_TTL_MS,
  type PendingBrowserChatPairing,
} from "./pairing";

const now = Date.parse("2026-07-29T18:00:00.000Z");
const origin = "https://dispatch.agent-native.com";
const pending: PendingBrowserChatPairing = {
  nonce: "nonce-example-123456789012",
  dispatchOrigin: origin,
  createdAt: now - 1_000,
};
const sender = { origin } as chrome.runtime.MessageSender;

function sessionMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: BROWSER_CHAT_SESSION_MESSAGE_TYPE,
    nonce: pending.nonce,
    startPath: "/_agent-native/embed/start?ticket=example-ticket",
    dispatchOrigin: origin,
    expiresAt: new Date(now + 60_000).toISOString(),
    ...overrides,
  };
}

describe("browser chat secure pairing", () => {
  it("accepts one exact-origin, nonce-bound, unexpired start path", () => {
    expect(
      acceptBrowserChatSession(sessionMessage(), sender, pending, now),
    ).toEqual({
      nonce: pending.nonce,
      dispatchOrigin: origin,
      startUrl:
        "https://dispatch.agent-native.com/_agent-native/embed/start?ticket=example-ticket",
      expiresAt: new Date(now + 60_000).toISOString(),
      receivedAt: now,
    });
  });

  it("rejects wrong origins, nonces, stale pairing, and unsafe paths", () => {
    expect(
      acceptBrowserChatSession(
        sessionMessage(),
        { origin: "https://malicious.example" } as chrome.runtime.MessageSender,
        pending,
        now,
      ),
    ).toBeNull();
    expect(
      acceptBrowserChatSession(
        sessionMessage({ nonce: "nonce-wrong-12345678901234" }),
        sender,
        pending,
        now,
      ),
    ).toBeNull();
    expect(
      acceptBrowserChatSession(
        sessionMessage(),
        sender,
        { ...pending, createdAt: now - PAIRING_TTL_MS - 1 },
        now,
      ),
    ).toBeNull();
    expect(
      acceptBrowserChatSession(
        sessionMessage({ startPath: "https://malicious.example/ticket" }),
        sender,
        pending,
        now,
      ),
    ).toBeNull();
  });

  it("requires a future expiry within the bounded ticket window", () => {
    expect(
      acceptBrowserChatSession(
        sessionMessage({ expiresAt: new Date(now - 1).toISOString() }),
        sender,
        pending,
        now,
      ),
    ).toBeNull();
    expect(
      acceptBrowserChatSession(
        sessionMessage({
          expiresAt: new Date(now + MAX_SESSION_EXPIRY_MS + 1).toISOString(),
        }),
        sender,
        pending,
        now,
      ),
    ).toBeNull();
  });
});

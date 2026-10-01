import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cooldowns: new Map<string, number>(),
  reservation: { retryAfterMs: 0, quotaCooldownAttempts: 0 },
  tokens: new Map<
    string,
    { ownerEmail: string; accountEmail: string; expiresAt: number }
  >(),
}));
const countOutcome = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/tracking", () => ({ countOutcome }));

vi.mock("./inbox-store.js", () => ({
  reserveGmailQuota: vi.fn(async () => state.reservation),
  recordGmailQuotaCooldown: vi.fn(async () => 1),
  clearGmailQuotaCooldownAfterSuccess: vi.fn(),
  saveGmailTokenAccount: async (
    tokenHash: string,
    account: { ownerEmail: string; accountEmail: string; expiresAt: number },
  ) => {
    state.tokens.set(tokenHash, account);
  },
  readGmailTokenAccount: async (tokenHash: string) =>
    state.tokens.get(tokenHash),
  readGmailQuotaCooldowns: async (scope: {
    accountEmails: readonly string[];
  }) =>
    new Map(
      [...state.cooldowns].filter(([account, until]) => {
        return until > Date.now() && scope.accountEmails.includes(account);
      }),
    ),
}));

import {
  acquireGmailQuota,
  assertGmailNotCoolingDown,
  registerGmailAccountToken,
  tripGmailQuotaCooldown,
} from "./gmail-quota.js";

function counted() {
  return countOutcome.mock.calls.map(([event, dimensions]) => [
    event,
    dimensions,
  ]);
}

describe("Gmail cooldown counts", () => {
  beforeEach(() => {
    countOutcome.mockClear();
    state.cooldowns.clear();
    state.tokens.clear();
    state.reservation = { retryAfterMs: 0, quotaCooldownAttempts: 0 };
  });

  it("counts an agent read refused locally while every account cools down, not a partial one", async () => {
    state.cooldowns.set("a@example.com", Date.now() + 30_000);

    await expect(
      assertGmailNotCoolingDown(["a@example.com"]),
    ).rejects.toThrow();
    await assertGmailNotCoolingDown(["a@example.com", "b@example.com"]);

    expect(counted()).toEqual([
      [
        "gmail_cooldown_counts",
        { site: "rejected_agent_precheck", freshness: undefined },
      ],
    ]);
  });

  it("counts a request refused by the persisted budget and a Gmail 429 that opened a cooldown", async () => {
    await registerGmailAccountToken(
      "fake-token",
      "owner@example.com",
      "mail@example.com",
    );

    state.reservation = { retryAfterMs: 5_000, quotaCooldownAttempts: 1 };
    await expect(
      acquireGmailQuota("fake-token", 5, "interactive"),
    ).rejects.toThrow();
    await tripGmailQuotaCooldown("fake-token", 30_000);

    expect(counted().map(([, dimensions]) => dimensions)).toEqual([
      { site: "rejected_local", freshness: undefined },
      { site: "tripped", freshness: undefined },
    ]);
  });

  it("counts nothing for a read that goes through, and never names an account or token", async () => {
    await registerGmailAccountToken(
      "fake-token",
      "owner@example.com",
      "mail@example.com",
    );
    await acquireGmailQuota("fake-token", 5, "interactive");
    expect(countOutcome).not.toHaveBeenCalled();

    state.reservation = { retryAfterMs: 5_000, quotaCooldownAttempts: 1 };
    await acquireGmailQuota("fake-token", 5, "interactive").catch(() => {});
    const text = JSON.stringify(counted());
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("fake-token");
  });
});

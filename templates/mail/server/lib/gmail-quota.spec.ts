import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const quotaState = vi.hoisted(() => ({
  reservations: [] as Array<[string, string, number, string]>,
  // The shared database: every "instance" below reads and writes these.
  tokens: new Map<
    string,
    { ownerEmail: string; accountEmail: string; expiresAt: number }
  >(),
  cooldowns: new Map<string, number>(),
}));

vi.mock("./inbox-store.js", () => ({
  reserveGmailQuota: vi.fn(
    async (
      ownerEmail: string,
      accountEmail: string,
      units: number,
      lane: string,
    ) => {
      quotaState.reservations.push([ownerEmail, accountEmail, units, lane]);
      return { retryAfterMs: 0, quotaCooldownAttempts: 0 };
    },
  ),
  recordGmailQuotaCooldown: vi.fn(),
  clearGmailQuotaCooldownAfterSuccess: vi.fn(),
  saveGmailTokenAccount: async (
    tokenHash: string,
    account: { ownerEmail: string; accountEmail: string; expiresAt: number },
  ) => {
    quotaState.tokens.set(tokenHash, account);
  },
  readGmailTokenAccount: async (tokenHash: string, now = Date.now()) => {
    const stored = quotaState.tokens.get(tokenHash);
    return stored && stored.expiresAt > now ? stored : undefined;
  },
  readGmailQuotaCooldowns: async (
    scope: { accountEmails: readonly string[] },
    now = Date.now(),
  ) =>
    new Map(
      [...quotaState.cooldowns].filter(
        ([account, until]) =>
          until > now && scope.accountEmails.includes(account),
      ),
    ),
}));

import {
  acquireGmailQuota,
  assertGmailNotCoolingDown,
  GmailQuotaAccountUnavailableError,
  GmailQuotaCooldownError,
  registerGmailAccountToken,
} from "./gmail-quota.js";

describe("Gmail quota token registrations", () => {
  beforeEach(() => {
    quotaState.reservations.length = 0;
    quotaState.tokens.clear();
    quotaState.cooldowns.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hashes token keys and keeps refreshed registrations until their expiry", async () => {
    const now = Date.now();
    const expiredToken = "fake-expired-access-token";
    const previousToken = "fake-previous-access-token";
    const refreshedToken = "fake-refreshed-access-token";
    const mapSet = vi.spyOn(Map.prototype, "set");

    await registerGmailAccountToken(
      expiredToken,
      "Steve@Example.com",
      "Mail@Example.com",
      now - 1,
    );
    await registerGmailAccountToken(
      previousToken,
      "Steve@Example.com",
      "Mail@Example.com",
      now + 1_000,
    );
    await registerGmailAccountToken(
      refreshedToken,
      "Steve@Example.com",
      "Mail@Example.com",
      now + 60 * 60_000,
    );

    const registryKeys = mapSet.mock.calls.map(([key]) => key);
    expect(registryKeys).not.toContain(expiredToken);
    expect(registryKeys).not.toContain(previousToken);
    expect(registryKeys).not.toContain(refreshedToken);

    await acquireGmailQuota(refreshedToken, 5, "interactive");
    vi.setSystemTime(now + 1_001);

    await expect(
      acquireGmailQuota(previousToken, 5, "interactive"),
    ).rejects.toBeInstanceOf(GmailQuotaAccountUnavailableError);
    await expect(
      acquireGmailQuota(expiredToken, 5, "interactive"),
    ).rejects.toBeInstanceOf(GmailQuotaAccountUnavailableError);
    await acquireGmailQuota(refreshedToken, 5, "interactive");

    expect(quotaState.reservations).toEqual([
      ["steve@example.com", "mail@example.com", 5, "interactive"],
      ["steve@example.com", "mail@example.com", 5, "interactive"],
    ]);
  });

  it("resolves a token registered by another instance from the shared table", async () => {
    await registerGmailAccountToken(
      "fake-cross-instance-token",
      "Steve@Example.com",
      "Mail@Example.com",
    );

    // A cold or different serverless instance: no in-memory registrations.
    vi.resetModules();
    const cold = await import("./gmail-quota.js");

    await cold.acquireGmailQuota("fake-cross-instance-token", 7, "incremental");
    expect(quotaState.reservations).toEqual([
      ["steve@example.com", "mail@example.com", 7, "incremental"],
    ]);
  });

  it("keeps an unregistered token a distinct, loud error", async () => {
    const error = await acquireGmailQuota(
      "fake-never-registered-token",
      5,
      "interactive",
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GmailQuotaAccountUnavailableError);
    expect(error).toMatchObject({
      errorCode: "gmail_quota_account_unresolved",
    });
    expect(error).not.toBeInstanceOf(GmailQuotaCooldownError);
    expect(quotaState.reservations).toEqual([]);
  });

  it("writes a token's mapping once, not on every Gmail call, and refreshes it before it lapses", async () => {
    const writes = vi.spyOn(quotaState.tokens, "set");
    const start = Date.now();

    // A managed client's token has no real expiry: each call passes the
    // default, which is later every time.
    for (let call = 0; call < 50; call += 1) {
      vi.setSystemTime(start + call * 30_000);
      await registerGmailAccountToken(
        "fake-managed-token",
        "steve@example.com",
        "mail@example.com",
      );
    }
    expect(writes).toHaveBeenCalledTimes(1);

    // Near the end of the stored lifetime the row is extended, once.
    vi.setSystemTime(start + 55 * 60_000);
    await registerGmailAccountToken(
      "fake-managed-token",
      "steve@example.com",
      "mail@example.com",
    );
    await registerGmailAccountToken(
      "fake-managed-token",
      "steve@example.com",
      "mail@example.com",
    );
    expect(writes).toHaveBeenCalledTimes(2);

    // A token with a real expiry is written once for its whole life.
    for (let call = 0; call < 10; call += 1) {
      await registerGmailAccountToken(
        "fake-oauth-token",
        "steve@example.com",
        "mail@example.com",
        start + 70 * 60_000,
      );
    }
    expect(writes).toHaveBeenCalledTimes(3);
  });

  it("does not hand out a token the shared table could not store", async () => {
    const stored = quotaState.tokens;
    const failure = new Error("table unavailable");
    vi.spyOn(stored, "set").mockImplementation(() => {
      throw failure;
    });

    await expect(
      registerGmailAccountToken(
        "fake-unpersisted-token",
        "steve@example.com",
        "mail@example.com",
      ),
    ).rejects.toBe(failure);
    // Not cached either, so the next registration tries to persist again.
    vi.restoreAllMocks();
    await expect(
      acquireGmailQuota("fake-unpersisted-token", 5, "interactive"),
    ).rejects.toBeInstanceOf(GmailQuotaAccountUnavailableError);
  });
});

describe("Gmail cooldown as a value", () => {
  beforeEach(() => {
    quotaState.cooldowns.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("carries the typed fields and tells the caller not to retry", () => {
    const error = new GmailQuotaCooldownError(45_000);

    expect(error).toMatchObject({
      actionContractError: true,
      statusCode: 429,
      errorCode: "gmail_quota_cooldown",
      retryAfterMs: 45_000,
      cooldownUntil: Date.now() + 45_000,
      details: {
        retryAfterSeconds: 45,
        retryAfterMs: 45_000,
        cooldownUntil: Date.now() + 45_000,
      },
    });
    expect(error.message).toContain("ready again in about 45s");
    expect(error.message).toContain("Do not retry before then");
  });

  it("rejects locally with the same typed error while every account cools down, then recovers", async () => {
    const until = Date.now() + 30_000;
    quotaState.cooldowns.set("a@example.com", until);

    const error = await assertGmailNotCoolingDown(["a@example.com"]).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(GmailQuotaCooldownError);
    expect(error).toMatchObject({
      errorCode: "gmail_quota_cooldown",
      retryAfterMs: 30_000,
      cooldownUntil: until,
    });
    // Another account is healthy: a partial read can still proceed live.
    await expect(
      assertGmailNotCoolingDown(["a@example.com", "b@example.com"]),
    ).resolves.toBeUndefined();

    vi.setSystemTime(until + 1);
    await expect(
      assertGmailNotCoolingDown(["a@example.com"]),
    ).resolves.toBeUndefined();
  });
});

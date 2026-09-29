import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const quotaState = vi.hoisted(() => ({
  reservations: [] as Array<[string, string, number, string]>,
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
}));

import {
  acquireGmailQuota,
  GmailQuotaAccountUnavailableError,
  registerGmailAccountToken,
} from "./gmail-quota.js";

describe("Gmail quota token registrations", () => {
  beforeEach(() => {
    quotaState.reservations.length = 0;
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

    registerGmailAccountToken(
      expiredToken,
      "Steve@Example.com",
      "Mail@Example.com",
      now - 1,
    );
    registerGmailAccountToken(
      previousToken,
      "Steve@Example.com",
      "Mail@Example.com",
      now + 1_000,
    );
    registerGmailAccountToken(
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
});

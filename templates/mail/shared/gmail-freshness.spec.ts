import { describe, expect, it } from "vitest";

import {
  gmailCooldownFromError,
  gmailReadFreshness,
  gmailReadState,
  parseGmailReadState,
} from "./gmail-freshness";

const NOW = 1_790_000_000_000;

describe("gmailCooldownFromError", () => {
  it("reads a typed action error from either field location", () => {
    expect(
      gmailCooldownFromError(
        {
          errorCode: "gmail_quota_cooldown",
          status: 429,
          details: { retryAfterMs: 30_000, cooldownUntil: NOW + 30_000 },
        },
        NOW,
      ),
    ).toEqual({ retryAfterMs: 30_000, cooldownUntil: NOW + 30_000 });
    expect(
      gmailCooldownFromError(
        { errorCode: "gmail_quota_cooldown", retryAfterMs: 8_000 },
        NOW,
      ),
    ).toEqual({ retryAfterMs: 8_000, cooldownUntil: NOW + 8_000 });
  });

  it("derives the wait from cooldownUntil when only the deadline is known", () => {
    expect(
      gmailCooldownFromError(
        { errorCode: "gmail_quota_cooldown", cooldownUntil: NOW + 5_000 },
        NOW,
      ),
    ).toEqual({ retryAfterMs: 5_000, cooldownUntil: NOW + 5_000 });
  });

  it("accepts a REST 429 with Retry-After and no code, but not other failures", () => {
    expect(
      gmailCooldownFromError({ status: 429, retryAfterMs: 45_000 }, NOW),
    ).toEqual({ retryAfterMs: 45_000, cooldownUntil: NOW + 45_000 });
    expect(gmailCooldownFromError({ status: 429 }, NOW)).toBeUndefined();
    expect(
      gmailCooldownFromError({ status: 502, retryAfterMs: 5_000 }, NOW),
    ).toBeUndefined();
    expect(
      gmailCooldownFromError(
        { status: 429, errorCode: "rate_limited", retryAfterMs: 5_000 },
        NOW,
      ),
    ).toBeUndefined();
    expect(gmailCooldownFromError(null, NOW)).toBeUndefined();
  });
});

describe("gmail read state", () => {
  it("is live without a cooldown and cached or stale with one", () => {
    const cooldown = { cooldownUntil: NOW + 10_000, retryAfterMs: 10_000 };

    expect(gmailReadState(null, NOW - 1_000, NOW)).toEqual({
      freshness: "live",
    });
    expect(gmailReadState(cooldown, NOW - 60_000, NOW)).toEqual({
      freshness: "cached",
      staleSince: NOW - 60_000,
      ...cooldown,
    });
    expect(gmailReadFreshness(NOW - 30 * 60_000, NOW)).toBe("stale");
    // Never synced is not "recent".
    expect(gmailReadState(cooldown, null, NOW).freshness).toBe("stale");
  });

  it("parses only well-formed states", () => {
    expect(
      parseGmailReadState({ freshness: "cached", cooldownUntil: NOW }),
    ).toEqual({ freshness: "cached", cooldownUntil: NOW });
    expect(parseGmailReadState({ freshness: "fresh" })).toBeUndefined();
    expect(parseGmailReadState("cached")).toBeUndefined();
  });
});

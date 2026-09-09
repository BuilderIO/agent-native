// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RATE_LIMIT_COOLDOWN_MS,
  isRateLimited,
  noteRateLimitCooldownMs,
  noteRateLimitedResponse,
  parseRetryAfterMs,
  rateLimitCooldownRemainingMs,
  resetRateLimitSignalForTests,
  subscribeRateLimitSignal,
} from "./rate-limit-signal.js";

function res(status: number, retryAfter?: string) {
  return {
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null,
    },
  };
}

describe("parseRetryAfterMs", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");

  it("reads delta-seconds", () => {
    expect(parseRetryAfterMs("30", now)).toBe(30_000);
    expect(parseRetryAfterMs("  0 ", now)).toBe(0);
  });

  it("reads an HTTP-date relative to now", () => {
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:45 GMT", now)).toBe(
      45_000,
    );
  });

  it("never reports a negative delay for a past HTTP-date", () => {
    expect(
      parseRetryAfterMs("Thu, 01 Jan 2026 00:00:00 GMT", now + 5_000),
    ).toBe(0);
  });

  it("reports no usable value rather than zero when the header is missing or junk", () => {
    // Zero would be indistinguishable from the server saying "go ahead now".
    expect(parseRetryAfterMs(null, now)).toBeNull();
    expect(parseRetryAfterMs(undefined, now)).toBeNull();
    expect(parseRetryAfterMs("", now)).toBeNull();
    expect(parseRetryAfterMs("soon", now)).toBeNull();
    expect(parseRetryAfterMs("-5", now)).toBeNull();
  });
});

describe("rate limit signal", () => {
  beforeEach(() => {
    resetRateLimitSignalForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRateLimitSignalForTests();
  });

  it("starts clean", () => {
    expect(isRateLimited()).toBe(false);
    expect(rateLimitCooldownRemainingMs()).toBe(0);
  });

  it("ignores non-429 responses so call sites need not branch", () => {
    noteRateLimitedResponse(res(200));
    noteRateLimitedResponse(res(503, "60"));
    expect(isRateLimited()).toBe(false);
  });

  it("honors Retry-After on a 429", () => {
    noteRateLimitedResponse(res(429, "45"));
    expect(rateLimitCooldownRemainingMs()).toBe(45_000);
  });

  it("falls back to the default cooldown when Retry-After is unusable", () => {
    noteRateLimitedResponse(res(429, "whenever"));
    expect(rateLimitCooldownRemainingMs()).toBe(DEFAULT_RATE_LIMIT_COOLDOWN_MS);
  });

  it("floors a Retry-After: 0 instead of treating it as no cooldown", () => {
    noteRateLimitedResponse(res(429, "0"));
    expect(rateLimitCooldownRemainingMs()).toBe(1_000);
  });

  it("caps an absurd Retry-After", () => {
    noteRateLimitedResponse(res(429, "86400"));
    expect(rateLimitCooldownRemainingMs()).toBe(5 * 60_000);
  });

  it("extends but never shortens an active cooldown", () => {
    noteRateLimitCooldownMs(120_000);
    noteRateLimitCooldownMs(5_000);
    expect(rateLimitCooldownRemainingMs()).toBe(120_000);

    noteRateLimitCooldownMs(180_000);
    expect(rateLimitCooldownRemainingMs()).toBe(180_000);
  });

  it("expires on its own without needing an event", () => {
    noteRateLimitCooldownMs(10_000);
    vi.advanceTimersByTime(9_999);
    expect(isRateLimited()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isRateLimited()).toBe(false);
    expect(rateLimitCooldownRemainingMs()).toBe(0);
  });

  it("survives a reload so a reloaded page does not re-burst into the limit", async () => {
    noteRateLimitedResponse(res(429, "60"));
    expect(window.sessionStorage.getItem("agent-native:rate-limit-until")).toBe(
      String(Date.now() + 60_000),
    );

    // Fresh module state is what a reload actually gives us.
    vi.resetModules();
    const reloaded = await import("./rate-limit-signal.js");
    expect(reloaded.isRateLimited()).toBe(true);
    expect(reloaded.rateLimitCooldownRemainingMs()).toBe(60_000);
  });

  it("does not resurrect an expired cooldown from a previous load", async () => {
    noteRateLimitCooldownMs(10_000);
    vi.advanceTimersByTime(10_001);

    vi.resetModules();
    const reloaded = await import("./rate-limit-signal.js");
    expect(reloaded.isRateLimited()).toBe(false);
  });

  it("notifies subscribers when a cooldown is recorded or extended", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeRateLimitSignal(seen);

    noteRateLimitedResponse(res(429, "30"));
    expect(seen).toHaveBeenCalledTimes(1);

    // Shorter than the live cooldown — nothing changed, so no notification.
    noteRateLimitedResponse(res(429, "5"));
    expect(seen).toHaveBeenCalledTimes(1);

    noteRateLimitedResponse(res(429, "60"));
    expect(seen).toHaveBeenCalledTimes(2);

    unsubscribe();
    noteRateLimitedResponse(res(429, "120"));
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

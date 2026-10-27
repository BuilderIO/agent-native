import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActionCircuitOpenError,
  actionCircuitRemainingMs,
  assertActionCircuitClosed,
  isActionCircuitOpenError,
  isTerminalActionError,
  recordActionFailure,
  resetActionFailureCircuit,
  resetActionFailureCircuits,
} from "./action-failure-circuit.js";

const refused = Object.assign(new Error("Bad input"), { status: 422 });

function failTimes(key: string, error: unknown, times: number, now = 0) {
  for (let i = 0; i < times; i++) recordActionFailure(key, error, now);
}

describe("isTerminalActionError", () => {
  it("is terminal for client errors, not for timeouts, rate limits or server errors", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 424]) {
      expect(isTerminalActionError({ status })).toBe(true);
    }
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isTerminalActionError({ status })).toBe(false);
    }
  });

  it("is terminal for non-retryable typed codes whatever the status", () => {
    for (const errorCode of [
      "not_found",
      "forbidden",
      "unauthorized",
      "gmail_quota_cooldown",
      "llm_provider_missing",
      "conflict",
    ]) {
      expect(isTerminalActionError({ status: 500, errorCode })).toBe(true);
    }
    expect(isTerminalActionError({ status: 500, errorCode: "other" })).toBe(
      false,
    );
    expect(isTerminalActionError(undefined)).toBe(false);
  });
});

describe("action failure circuit", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    resetActionFailureCircuits();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("never opens for server or network failures, which retry and backoff own", () => {
    for (const error of [
      { status: 500 },
      { status: 502 },
      { status: 503 },
      { status: 504 },
      { status: 408 },
      { status: 429 },
      new TypeError("Failed to fetch"),
      new Error("Action list-things failed: fetch failed"),
    ]) {
      const trips = Array.from(
        { length: 20 },
        () => recordActionFailure("k", error, 0).tripped,
      );
      expect(trips.some(Boolean), JSON.stringify(error)).toBe(false);
      expect(actionCircuitRemainingMs("k", 0)).toBe(0);
      expect(() => assertActionCircuitClosed("k", 0)).not.toThrow();
    }
  });

  it("stays closed below the failure threshold", () => {
    failTimes("k", refused, 4);
    expect(actionCircuitRemainingMs("k", 0)).toBe(0);
    expect(() => assertActionCircuitClosed("k", 0)).not.toThrow();
  });

  it("says when a failure tripped the circuit, once per closed-to-open transition", () => {
    const trips: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      trips.push(recordActionFailure("k", refused, 0).tripped);
    }
    // The fifth failure opens it; the sixth lands while it is already open.
    expect(trips).toEqual([false, false, false, false, true, false]);

    // After the cooldown ran out, the next failure re-opens it: a new trip.
    const reopened = recordActionFailure("k", refused, 1_000_000);
    expect(reopened).toMatchObject({ tripped: true, failures: 7 });
    expect(reopened.cooldownMs).toBeGreaterThan(0);
  });

  it("opens on the fifth consecutive failure and doubles each time up to the cap", () => {
    failTimes("k", refused, 5);
    expect(actionCircuitRemainingMs("k", 0)).toBe(15_000);
    recordActionFailure("k", refused, 0);
    expect(actionCircuitRemainingMs("k", 0)).toBe(30_000);
    recordActionFailure("k", refused, 0);
    expect(actionCircuitRemainingMs("k", 0)).toBe(60_000);
    failTimes("k", refused, 10);
    expect(actionCircuitRemainingMs("k", 0)).toBe(300_000);
  });

  it("jitters the cooldown by up to 20 percent either way", () => {
    vi.mocked(Math.random).mockReturnValue(0);
    failTimes("low", refused, 5);
    expect(actionCircuitRemainingMs("low", 0)).toBe(12_000);
    vi.mocked(Math.random).mockReturnValue(1);
    failTimes("high", refused, 5);
    expect(actionCircuitRemainingMs("high", 0)).toBe(18_000);
  });

  it("rejects with the last error's typed fields while open and closes after the cooldown", () => {
    const last = Object.assign(new Error("Server said no"), {
      status: 422,
      errorCode: "invalid_source_sql",
      actionMessage: "Server said no",
    });
    failTimes("k", last, 5);

    let thrown: unknown;
    try {
      assertActionCircuitClosed("k", 1_000);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ActionCircuitOpenError);
    expect(isActionCircuitOpenError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      message: "Server said no",
      status: 422,
      errorCode: "invalid_source_sql",
      actionMessage: "Server said no",
      cause: last,
    });

    expect(() => assertActionCircuitClosed("k", 15_000)).not.toThrow();
  });

  it("opens at once for a named Retry-After and honors its length", () => {
    recordActionFailure(
      "k",
      { status: 429, errorCode: "gmail_quota_cooldown", retryAfterMs: 45_000 },
      0,
    );
    expect(actionCircuitRemainingMs("k", 0)).toBe(45_000);
  });

  it("holds a missing LLM provider for the maximum cooldown on the first failure", () => {
    recordActionFailure(
      "k",
      { status: 424, errorCode: "llm_provider_missing" },
      0,
    );
    expect(actionCircuitRemainingMs("k", 0)).toBe(300_000);
  });

  it("closes on a reset of one key or of every key", () => {
    failTimes("a", refused, 5);
    failTimes("b", refused, 5);
    resetActionFailureCircuit("a");
    expect(actionCircuitRemainingMs("a", 0)).toBe(0);
    expect(actionCircuitRemainingMs("b", 0)).toBeGreaterThan(0);
    resetActionFailureCircuits();
    expect(actionCircuitRemainingMs("b", 0)).toBe(0);
  });

  it("lets a fetch through while the user's gesture is active", () => {
    failTimes("k", refused, 5);
    vi.stubGlobal("navigator", { userActivation: { isActive: true } });
    expect(() => assertActionCircuitClosed("k", 0)).not.toThrow();
    vi.stubGlobal("navigator", { userActivation: { isActive: false } });
    expect(() => assertActionCircuitClosed("k", 0)).toThrow(
      ActionCircuitOpenError,
    );
  });

  it("evicts the oldest circuit past the tracking cap", () => {
    for (let i = 0; i < 201; i++) {
      recordActionFailure(`key-${i}`, { status: 429, retryAfterMs: 1_000 }, 0);
    }
    expect(actionCircuitRemainingMs("key-0", 0)).toBe(0);
    expect(actionCircuitRemainingMs("key-200", 0)).toBe(1_000);
  });
});

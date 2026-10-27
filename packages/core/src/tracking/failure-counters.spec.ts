import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const track = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ track }));

import {
  countActionFailure,
  countAttachmentOutcome,
  countCredentialState,
  countOutcome,
  resetFailureCountersForTests,
} from "./failure-counters.js";

function emitted(): Array<Record<string, unknown>> {
  return track.mock.calls.map(
    ([name, properties]) =>
      ({ name, ...properties }) as Record<string, unknown>,
  );
}

function total(): number {
  return emitted().reduce((sum, event) => sum + Number(event.count), 0);
}

describe("failure counters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    track.mockReset();
    resetFailureCountersForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetFailureCountersForTests();
  });

  it("ships the first failure at once and the rest as one counted event per window", () => {
    for (let i = 0; i < 100; i += 1) {
      countActionFailure({
        action: "list-emails",
        status: 429,
        errorCode: "gmail_quota_cooldown",
        caller: "frontend",
      });
    }

    expect(track).toHaveBeenCalledTimes(1);
    expect(emitted()[0]).toMatchObject({
      name: "action_error_counts",
      action_name: "list-emails",
      error_code: "gmail_quota_cooldown",
      status_class: "4xx",
      action_source: "frontend",
      count: 1,
      aggregated: false,
      window_ms: 60_000,
    });

    vi.advanceTimersByTime(60_000);

    expect(track).toHaveBeenCalledTimes(2);
    expect(emitted()[1]).toMatchObject({ count: 99, aggregated: true });
    expect(total()).toBe(100);
  });

  it("carries the pending count on the next failure when no timer ran", () => {
    for (let i = 0; i < 5; i += 1) {
      countActionFailure({ action: "a", status: 500 });
    }
    vi.clearAllTimers();
    vi.setSystemTime(Date.now() + 61_000);

    countActionFailure({ action: "a", status: 500 });

    expect(track).toHaveBeenCalledTimes(2);
    expect(emitted()[1]).toMatchObject({ count: 5, aggregated: true });
    expect(total()).toBe(6);
  });

  it("separates actions, codes and status classes into their own counters", () => {
    countActionFailure({ action: "a", status: 500 });
    countActionFailure({ action: "a", status: 500, errorCode: "not_found" });
    countActionFailure({ action: "b", status: 500 });
    countActionFailure({ action: "a", status: 404 });

    expect(track).toHaveBeenCalledTimes(4);
    expect(emitted()[0]).toMatchObject({ error_code: "untyped" });
  });

  it("keeps dimensions to bounded tokens", () => {
    countActionFailure({
      action: "weird name/with spaces",
      status: 500,
      errorCode: "x".repeat(500),
    });
    const event = emitted()[0];
    expect(event.action_name).toBe("weird_name_with_spaces");
    expect(String(event.error_code)).toHaveLength(80);
  });

  it("counts a credential state with its kind and source, and ignores a usable one", () => {
    countCredentialState({ kind: "usable" }, "credit_notice");
    expect(track).not.toHaveBeenCalled();

    countCredentialState(
      { kind: "exhausted", period: "daily", plan: "free" },
      "credit_notice",
    );
    countCredentialState(
      { kind: "missing", credential: "provider" },
      "action_route",
    );

    expect(emitted()).toEqual([
      expect.objectContaining({
        name: "credential_state_counts",
        credential_state: "exhausted",
        credential_period: "daily",
        source: "credit_notice",
        count: 1,
      }),
      expect.objectContaining({
        credential_state: "missing",
        credential_subject: "provider",
        source: "action_route",
      }),
    ]);
  });

  it("stays bounded under a many-key incident and loses no count", () => {
    for (let i = 0; i < 1000; i += 1) {
      countActionFailure({ action: `action-${i}`, status: 500 });
    }
    vi.advanceTimersByTime(60_000);

    expect(total()).toBe(1000);
    expect(track.mock.calls.length).toBeLessThanOrEqual(401);
    expect(emitted().some((event) => event.overflow === "true")).toBe(true);
  });

  it("counts attachment outcomes by operation, status and reason, ok included", () => {
    countAttachmentOutcome({ operation: "resolve", status: "ok" });
    countAttachmentOutcome({
      operation: "resolve",
      status: "storageUnavailable",
      reason: "provider_unavailable",
      whoCanFix: "self_resolving",
    });

    expect(emitted()).toEqual([
      expect.objectContaining({
        name: "attachment_outcome_counts",
        operation: "resolve",
        status: "ok",
        count: 1,
      }),
      expect.objectContaining({
        status: "storageUnavailable",
        reason: "provider_unavailable",
        who_can_fix: "self_resolving",
      }),
    ]);
  });

  it("lets other code count its own outcome classes under a <thing>_counts name", () => {
    countOutcome("gmail_cooldown_counts", { site: "tripped" });
    countOutcome("gmail_cooldown_counts", { site: "tripped" });

    expect(emitted()).toEqual([
      expect.objectContaining({
        name: "gmail_cooldown_counts",
        site: "tripped",
        count: 1,
      }),
    ]);
    vi.advanceTimersByTime(60_000);
    expect(total()).toBe(2);
  });

  it("reports a badly named event once and drops it instead of throwing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => countOutcome("Gmail Cooldown", { site: "x" })).not.toThrow();
    countOutcome("gmail_cooldown", { site: "x" });

    expect(track).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("never lets a failing tracker break the caller", () => {
    track.mockImplementation(() => {
      throw new Error("tracker down");
    });
    expect(() =>
      countActionFailure({ action: "a", status: 500 }),
    ).not.toThrow();
  });
});

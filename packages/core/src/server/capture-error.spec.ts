import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REPORT_EXPECTED_FAILURE_TAG } from "../shared/error-noise.js";
import {
  captureError,
  getCaptureErrorStats,
  registerErrorCaptureProvider,
  resetCaptureErrorStateForTests,
} from "./capture-error.js";
import { runWithRequestContext } from "./request-context.js";

describe("server captureError", () => {
  it("no-ops when no capture provider is registered", () => {
    expect(captureError(new Error("boom"))).toBeUndefined();
  });

  it("forwards errors and context to registered providers", () => {
    const err = new Error("boom");
    const provider = vi.fn(() => "evt_test");
    const unregister = registerErrorCaptureProvider("test", provider);

    const result = captureError(err, {
      route: "/_agent-native/agent-chat",
      tags: { source: "agent-run-manager" },
      extra: { runId: "run_123" },
    });

    unregister();

    expect(result).toBe("evt_test");
    expect(provider).toHaveBeenCalledWith(err, {
      route: "/_agent-native/agent-chat",
      tags: { source: "agent-run-manager" },
      extra: {
        runId: "run_123",
        failureContext: expect.objectContaining({
          runId: "run_123",
          route: "/_agent-native/agent-chat",
        }),
      },
      aiTraceId: "run_123",
    });
  });

  it("keeps going when a provider throws", () => {
    const throwing = vi.fn(() => {
      throw new Error("provider failed");
    });
    const working = vi.fn(() => "evt_ok");
    const unregisterThrowing = registerErrorCaptureProvider(
      "throwing",
      throwing,
    );
    const unregisterWorking = registerErrorCaptureProvider("working", working);

    const result = captureError(new Error("boom"));

    unregisterThrowing();
    unregisterWorking();

    expect(result).toBe("evt_ok");
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(working).toHaveBeenCalledTimes(1);
  });

  it("does not forward synthetic traffic to observability providers", () => {
    const provider = vi.fn(() => "evt_test");
    const unregister = registerErrorCaptureProvider("synthetic-test", provider);

    const result = runWithRequestContext({ isSyntheticTraffic: true }, () =>
      captureError(new Error("synthetic failure")),
    );

    unregister();

    expect(result).toBeUndefined();
    expect(provider).not.toHaveBeenCalled();
  });
});

function named(name: string, message: string, extra: object = {}): Error {
  const error = Object.assign(new Error(message), extra);
  error.name = name;
  return error;
}

const NEON_PASSWORD_FAILURE = () =>
  named(
    "NeonDbError",
    "password authentication failed for user 'neondb_owner'",
    { code: "28P01" },
  );

describe("captureError noise boundary", () => {
  let provider: ReturnType<typeof vi.fn>;
  let unregister: () => void;

  beforeEach(() => {
    resetCaptureErrorStateForTests();
    provider = vi.fn(() => "evt");
    unregister = registerErrorCaptureProvider("noise-test", provider);
  });
  afterEach(() => {
    unregister();
    vi.useRealTimers();
    resetCaptureErrorStateForTests();
  });

  it("filters explicit captureError() calls, not just the Nitro hook", () => {
    expect(captureError(named("ValidationError", "bad input"))).toBeUndefined();
    expect(
      captureError(named("HTTPError", "Not Found", { statusCode: 404 })),
    ).toBeUndefined();
    expect(provider).not.toHaveBeenCalled();
    expect(getCaptureErrorStats().noiseSuppressed).toEqual({
      validation: 1,
      "expected-http": 1,
    });
  });

  it("still reports an access-control failure the caller marks as a real failure", () => {
    const lostGrant = named("ForbiddenError", "Automation grant was revoked");

    // An unmarked ForbiddenError is a user's rejected request: noise.
    expect(captureError(lostGrant, { route: "/automation" })).toBeUndefined();
    expect(provider).not.toHaveBeenCalled();

    const id = captureError(lostGrant, {
      route: "/automation",
      tags: { [REPORT_EXPECTED_FAILURE_TAG]: "true" },
    });
    expect(id).toBe("evt");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(getCaptureErrorStats().noiseSuppressed).toEqual({
      "access-control": 1,
    });
  });

  it("drops the fuzz-harness label before it reaches a provider", () => {
    captureError(new Error("fuzz-intercepted-process-exit"));
    expect(provider).not.toHaveBeenCalled();
  });

  it("captures unknown failures untouched, with no aggregation", () => {
    const error = new Error("something nobody has classified");
    for (let i = 0; i < 5; i += 1) captureError(error, { route: "/x" });
    expect(provider).toHaveBeenCalledTimes(5);
    expect(provider).toHaveBeenLastCalledWith(error, {
      route: "/x",
      extra: { failureContext: expect.objectContaining({ route: "/x" }) },
    });
  });

  it("derives errorCode from the error when the caller did not tag one", () => {
    const error = Object.assign(new Error("run ended"), {
      errorCode: "missing_tools",
    });
    captureError(error, { tags: { source: "automation" } });
    expect(provider).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        tags: { source: "automation", errorCode: "missing_tools" },
      }),
    );
  });
});

describe("captureError failure context", () => {
  let provider: ReturnType<typeof vi.fn>;
  let unregister: () => void;

  beforeEach(() => {
    resetCaptureErrorStateForTests();
    provider = vi.fn(() => "evt");
    unregister = registerErrorCaptureProvider("failure-context-test", provider);
  });
  afterEach(() => {
    unregister();
    resetCaptureErrorStateForTests();
  });

  it("names the run's thread on a capture made anywhere inside the run", () => {
    runWithRequestContext({ run: { threadId: "thr_1", runId: "run_1" } }, () =>
      captureError(new Error("tool exploded"), { route: "/x" }),
    );

    const context = provider.mock.calls[0][1];
    expect(context.extra.failureContext).toMatchObject({
      threadId: "thr_1",
      runId: "run_1",
    });
    expect(context.aiTraceId).toBe("run_1");
  });

  it("carries the error's own code and the aggregation class into the packet", () => {
    const error = Object.assign(new Error("rejected"), {
      errorCode: "credential_rejected",
    });
    captureError(error, { route: "/x" });
    captureError(NEON_PASSWORD_FAILURE(), { route: "/y" });

    expect(provider.mock.calls[0][1].extra.failureContext).toMatchObject({
      errorCode: "credential_rejected",
    });
    expect(provider.mock.calls[1][1].extra.failureContext).toMatchObject({
      failureClass: "database-credential",
    });
  });

  it("keeps the last occurrence's packet on a flood summary", () => {
    vi.useFakeTimers();
    try {
      captureError(NEON_PASSWORD_FAILURE(), {
        route: "/p",
        failure: { threadId: "thr_first" },
      });
      captureError(NEON_PASSWORD_FAILURE(), {
        route: "/p",
        failure: { threadId: "thr_last" },
      });
      vi.advanceTimersByTime(60_000);
    } finally {
      vi.useRealTimers();
    }

    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1][1].extra).toMatchObject({
      suppressedCount: 1,
      failureContext: { threadId: "thr_last" },
    });
  });

  it("does not forward the caller's hint object to providers", () => {
    captureError(new Error("boom"), { failure: { runId: "run_x" } });
    const context = provider.mock.calls[0][1];
    expect(context.failure).toBeUndefined();
    expect(context.extra.failureContext.runId).toBe("run_x");
  });
});

describe("captureError flood control", () => {
  let provider: ReturnType<typeof vi.fn>;
  let unregister: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    resetCaptureErrorStateForTests();
    provider = vi.fn(() => "evt");
    unregister = registerErrorCaptureProvider("flood-test", provider);
  });
  afterEach(() => {
    unregister();
    vi.useRealTimers();
    resetCaptureErrorStateForTests();
  });

  it("reports a Neon credential failure once, then one summary per minute", () => {
    const route = "/_agent-native/application-state/calendar-view-preferences";
    for (let i = 0; i < 100; i += 1) {
      captureError(NEON_PASSWORD_FAILURE(), { route });
    }

    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][1]).toMatchObject({
      route,
      tags: { failureClass: "database-credential" },
    });
    expect(getCaptureErrorStats().floodSuppressed).toBe(99);

    vi.advanceTimersByTime(60_000);

    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1][1]).toMatchObject({
      route,
      tags: { failureClass: "database-credential", aggregated: "true" },
      extra: { suppressedCount: 99, aggregationWindowMs: 60_000 },
    });
  });

  it("tells distinct causes inside one class apart in the summary", () => {
    const route = "/_agent-native/poll";
    const timeout = () =>
      named("DbTimeoutError", "DB query timed out after 10000ms", {
        code: "CONNECT_TIMEOUT",
      });
    const refused = () =>
      named("Error", "Database is refusing connection attempts", {
        code: "08006",
      });
    captureError(timeout(), { route });
    for (let i = 0; i < 6; i += 1) captureError(timeout(), { route });
    for (let i = 0; i < 2; i += 1) captureError(refused(), { route });

    vi.advanceTimersByTime(60_000);

    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1][1].extra).toMatchObject({
      suppressedCount: 8,
      suppressedBreakdown: [
        { error: "DbTimeoutError: DB query timed out after 10000ms", count: 6 },
        { error: "Error: Database is refusing connection attempts", count: 2 },
      ],
    });
  });

  it("carries the count on the next occurrence when no timer ran", () => {
    const route = "/_agent-native/poll";
    captureError(NEON_PASSWORD_FAILURE(), { route });
    for (let i = 0; i < 4; i += 1)
      captureError(NEON_PASSWORD_FAILURE(), { route });
    // A fresh process would not have the timer; emulate its absence.
    vi.clearAllTimers();
    vi.setSystemTime(Date.now() + 61_000);

    captureError(NEON_PASSWORD_FAILURE(), { route });

    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1][1].extra).toMatchObject({
      suppressedCount: 4,
    });
  });

  it("emits nothing extra when a window ends with no suppressed events", () => {
    captureError(NEON_PASSWORD_FAILURE(), { route: "/a" });
    vi.advanceTimersByTime(120_000);
    expect(provider).toHaveBeenCalledTimes(1);
    captureError(NEON_PASSWORD_FAILURE(), { route: "/a" });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1][1].extra).not.toHaveProperty(
      "suppressedCount",
    );
  });

  it("keys the aggregate by class and route", () => {
    captureError(NEON_PASSWORD_FAILURE(), { route: "/a" });
    captureError(NEON_PASSWORD_FAILURE(), { route: "/b" });
    captureError(NEON_PASSWORD_FAILURE(), {
      route: "/a/123e4567-e89b-12d3-a456-426614174000",
    });
    captureError(NEON_PASSWORD_FAILURE(), {
      route: "/a/123e4567-e89b-12d3-a456-426614174999",
    });
    // /a, /b, and one normalized id route; the repeated id route is suppressed.
    expect(provider).toHaveBeenCalledTimes(3);
  });

  it("classifies transient database failures from the error and from the caller's tag", () => {
    const timeout = named(
      "DbTimeoutError",
      "DB query timed out after 10000ms (connection terminated)",
      { code: "CONNECT_TIMEOUT" },
    );
    captureError(timeout, { route: "/_agent-native/poll" });
    captureError(timeout, { route: "/_agent-native/poll" });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][1].tags).toMatchObject({
      failureClass: "transient-database",
    });

    const synthetic = new Error("Transient database failure in agent chat");
    captureError(synthetic, {
      route: "/_agent-native/agent-chat/runs",
      tags: { failureClass: "transient-database" },
    });
    captureError(synthetic, {
      route: "/_agent-native/agent-chat/runs",
      tags: { failureClass: "transient-database" },
    });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("classifies a wrapped error by its cause, as the agent-chat fallback wraps it", () => {
    const cause = named("NeonDbError", "password authentication failed", {
      code: "28P01",
    });
    const wrapped = () =>
      new Error("Transient database failure in agent chat", { cause });
    captureError(wrapped(), { route: "/_agent-native/agent-chat/runs" });
    captureError(wrapped(), { route: "/_agent-native/agent-chat/runs" });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][1].tags.failureClass).toBe(
      "database-credential",
    );
  });

  it("leaves the caller's own handled flag alone", () => {
    captureError(new Error("boom"), { handled: false });
    expect(provider.mock.calls[0][1]).toMatchObject({ handled: false });
  });

  it("classifies ddl-guard probe failures and an unavailable credential store", () => {
    captureError(
      new Error(
        'ensureSchemaObject: could not probe required schema "table application_state"; refusing to issue DDL',
      ),
      { route: "/x" },
    );
    captureError(
      named("CredentialStoreUnavailableError", "credential store unreachable"),
      { route: "/y" },
    );
    captureError(
      new Error(
        'ensureSchemaObject: could not probe required schema "table application_state"',
      ),
      { route: "/x" },
    );
    expect(provider).toHaveBeenCalledTimes(2);
    expect(
      provider.mock.calls.map((call) => call[1].tags.failureClass),
    ).toEqual(["database-credential", "database-credential"]);
  });

  it("latches a permanent configuration error for an hour", () => {
    const missingSecret = () =>
      named(
        "MissingAuthSecretError",
        "[agent-native] production configuration errors:\n- BETTER_AUTH_SECRET is not set",
        { code: "deploy_settings_required" },
      );
    for (let i = 0; i < 50; i += 1)
      captureError(missingSecret(), { route: "/mcp" });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][1].tags.failureClass).toBe("configuration");

    vi.advanceTimersByTime(10 * 60_000);
    expect(provider).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50 * 60_000);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1][1].extra).toMatchObject({
      suppressedCount: 49,
    });
  });

  it("keeps aggregation state bounded under a many-route incident", () => {
    for (let i = 0; i < 1000; i += 1) {
      captureError(NEON_PASSWORD_FAILURE(), { route: `/route-${i}` });
    }
    const stats = getCaptureErrorStats();
    expect(stats.activeFloodKeys).toBeLessThanOrEqual(200);
    expect(provider.mock.calls.length).toBeLessThanOrEqual(201);
    expect(stats.floodSuppressed + provider.mock.calls.length).toBe(1000);
  });

  it("does not let a throwing provider lose the suppression count", () => {
    provider.mockImplementationOnce(() => {
      throw new Error("provider down");
    });
    captureError(NEON_PASSWORD_FAILURE(), { route: "/p" });
    captureError(NEON_PASSWORD_FAILURE(), { route: "/p" });
    expect(getCaptureErrorStats().floodSuppressed).toBe(1);
  });
});

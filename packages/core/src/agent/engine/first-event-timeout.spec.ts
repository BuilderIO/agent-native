import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createFirstEventAbortController,
  FIRST_STREAM_EVENT_TIMEOUT_MS,
  STREAM_TOTAL_TIMEOUT_MS,
} from "./first-event-timeout.js";

describe("createFirstEventAbortController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts a stream that never produces a first event", () => {
    const parent = new AbortController();
    const abort = createFirstEventAbortController(parent.signal);

    vi.advanceTimersByTime(FIRST_STREAM_EVENT_TIMEOUT_MS - 1);
    expect(abort.signal.aborted).toBe(false);

    vi.advanceTimersByTime(1);
    expect(abort.signal.aborted).toBe(true);
    expect(abort.didTimeout()).toBe(true);
    expect(abort.timeoutMessage()).toContain("no stream events");
    abort.cleanup();
  });

  // The whole point of removing the in-loop no-progress watchdogs: a model
  // composing a large tool input emits nothing a consumer can see, and that is
  // healthy. The first event must buy the stream the full total budget.
  it("does not bound silence between events once the stream has spoken", () => {
    const parent = new AbortController();
    const abort = createFirstEventAbortController(parent.signal);

    vi.advanceTimersByTime(1_000);
    abort.markFirstEvent();

    vi.advanceTimersByTime(STREAM_TOTAL_TIMEOUT_MS - 1_001);
    expect(abort.signal.aborted).toBe(false);
    expect(abort.didTimeout()).toBe(false);
    abort.cleanup();
  });

  // The bound the runtimes with no outer budget (local dev, self-hosted, where
  // the soft timeout resolves to 0) depend on: a socket that wedges AFTER the
  // first frame must not hang the run forever.
  it("aborts a stream that outlives the total deadline, measured from the request start", () => {
    const parent = new AbortController();
    const abort = createFirstEventAbortController(parent.signal);

    vi.advanceTimersByTime(30_000);
    abort.markFirstEvent();

    vi.advanceTimersByTime(STREAM_TOTAL_TIMEOUT_MS - 30_000);
    expect(abort.signal.aborted).toBe(true);
    expect(abort.didTimeout()).toBe(true);
    expect(abort.timeoutMessage()).toContain("total stream deadline");
    abort.cleanup();
  });

  it("reports no timeout when the parent aborts", () => {
    const parent = new AbortController();
    const abort = createFirstEventAbortController(parent.signal);

    parent.abort("user");
    expect(abort.signal.aborted).toBe(true);
    expect(abort.didTimeout()).toBe(false);
    expect(abort.timeoutMessage()).toBeUndefined();
    abort.cleanup();
  });

  // A cancelled request is not a failed one. The engines read `didTimeout()` to
  // decide a failure was the transport's fault and retryable, so a deadline
  // left armed across a Stop would turn a user cancellation or a run-budget
  // abort into a resumable provider error. The provider does not necessarily
  // settle the moment the signal fires, and `cleanup()` only runs once it does.
  it("does not classify a cancelled request as a timeout while the provider settles", () => {
    const parent = new AbortController();
    const abort = createFirstEventAbortController(parent.signal);

    vi.advanceTimersByTime(5_000);
    abort.markFirstEvent();
    vi.advanceTimersByTime(5_000);
    parent.abort("user");

    // The provider takes its time unwinding, so `cleanup()` has not run yet.
    vi.advanceTimersByTime(STREAM_TOTAL_TIMEOUT_MS * 2);

    expect(abort.didTimeout()).toBe(false);
    expect(abort.timeoutMessage()).toBeUndefined();
    abort.cleanup();
  });

  it("does not classify a pre-first-event cancellation as a timeout", () => {
    const parent = new AbortController();
    const abort = createFirstEventAbortController(parent.signal);

    parent.abort("run_timeout");
    vi.advanceTimersByTime(FIRST_STREAM_EVENT_TIMEOUT_MS * 2);

    expect(abort.didTimeout()).toBe(false);
    expect(abort.timeoutMessage()).toBeUndefined();
    abort.cleanup();
  });

  // A frame already in flight when the Stop lands must not re-arm a deadline
  // on a request that is over.
  it("does not re-arm a deadline for a frame that lands after cancellation", () => {
    const parent = new AbortController();
    const abort = createFirstEventAbortController(parent.signal);

    parent.abort("user");
    abort.markFirstEvent();
    vi.advanceTimersByTime(STREAM_TOTAL_TIMEOUT_MS * 2);

    expect(abort.didTimeout()).toBe(false);
    expect(abort.timeoutMessage()).toBeUndefined();
    abort.cleanup();
  });

  it("stops both deadlines on cleanup", () => {
    const parent = new AbortController();
    const abort = createFirstEventAbortController(parent.signal);

    abort.markFirstEvent();
    abort.cleanup();

    vi.advanceTimersByTime(STREAM_TOTAL_TIMEOUT_MS * 2);
    expect(abort.signal.aborted).toBe(false);
    expect(abort.didTimeout()).toBe(false);
  });
});

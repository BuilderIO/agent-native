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

  it("does not classify a cancelled request as a timeout while the provider settles", () => {
    const parent = new AbortController();
    const abort = createFirstEventAbortController(parent.signal);

    vi.advanceTimersByTime(5_000);
    abort.markFirstEvent();
    vi.advanceTimersByTime(5_000);
    parent.abort("user");

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

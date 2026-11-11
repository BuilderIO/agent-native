import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOutboxRetryScheduler } from "./design-save-outbox-retry";

describe("createOutboxRetryScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs one retry per schedule and widens the gap each time", () => {
    const run = vi.fn();
    const scheduler = createOutboxRetryScheduler(run);

    scheduler.schedule();
    scheduler.schedule();
    vi.advanceTimersByTime(4_999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);

    scheduler.schedule();
    vi.advanceTimersByTime(14_999);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("starts the gaps over after the backoff is reset", () => {
    const run = vi.fn();
    const scheduler = createOutboxRetryScheduler(run);
    scheduler.schedule();
    vi.advanceTimersByTime(5_000);
    scheduler.schedule();
    vi.advanceTimersByTime(15_000);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.resetBackoff();
    scheduler.schedule();
    vi.advanceTimersByTime(5_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not arm a retry after dispose, so a save finishing late stays quiet", () => {
    const run = vi.fn();
    const scheduler = createOutboxRetryScheduler(run);

    scheduler.dispose();
    scheduler.schedule();
    scheduler.schedule(1_000);
    vi.advanceTimersByTime(600_000);

    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a pending retry on dispose", () => {
    const run = vi.fn();
    const scheduler = createOutboxRetryScheduler(run);
    scheduler.schedule();

    scheduler.dispose();
    vi.advanceTimersByTime(600_000);

    expect(run).not.toHaveBeenCalled();
  });

  it("schedules again once reactivated, as a remount does", () => {
    const run = vi.fn();
    const scheduler = createOutboxRetryScheduler(run);
    scheduler.dispose();

    scheduler.activate();
    scheduler.schedule(1_000);
    vi.advanceTimersByTime(1_000);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("lets a manual retry clear the pending one without disposing", () => {
    const run = vi.fn();
    const scheduler = createOutboxRetryScheduler(run);
    scheduler.schedule();

    scheduler.cancel();
    vi.advanceTimersByTime(600_000);
    expect(run).not.toHaveBeenCalled();

    scheduler.schedule(1_000);
    vi.advanceTimersByTime(1_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps the longest gap once the list runs out", () => {
    const run = vi.fn();
    const scheduler = createOutboxRetryScheduler(run);
    for (const gap of [5_000, 15_000, 45_000, 120_000, 300_000, 300_000]) {
      scheduler.schedule();
      vi.advanceTimersByTime(gap - 1);
      expect(run).toHaveBeenCalledTimes(0);
      vi.advanceTimersByTime(1);
      expect(run).toHaveBeenCalledTimes(1);
      run.mockClear();
    }
  });
});

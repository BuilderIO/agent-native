import { describe, expect, it, vi } from "vitest";

import {
  NativeBoundedFrameScheduler,
  NativeBoundedFrameSchedulerError,
} from "./native-bounded-frame-scheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const prepared = (validate: Promise<void> = Promise.resolve()) => ({
  validate,
  publish: vi.fn(async () => {}),
  reject: vi.fn(async (_error: unknown) => {}),
});

describe("bounded FIFO native frame scheduling", () => {
  it("serializes encoding, overlaps validation and publishes in submission order", async () => {
    const scheduler = new NativeBoundedFrameScheduler();
    const encodeA = deferred<ReturnType<typeof prepared>>();
    const validationA = deferred<void>();
    const validationB = deferred<void>();
    const startedB = deferred<void>();
    const a = prepared(validationA.promise);
    const b = prepared(validationB.promise);
    const slots: number[] = [];
    const first = scheduler.submit(async (slot) => {
      slots.push(slot);
      return encodeA.promise;
    });
    const second = scheduler.submit(async (slot) => {
      slots.push(slot);
      startedB.resolve();
      return b;
    });
    await Promise.resolve();
    expect(slots).toEqual([1]);
    expect(scheduler.encoding).toBe(true);
    expect(scheduler.pendingCount).toBe(2);
    expect(scheduler.canSubmit).toBe(false);
    expect(() => scheduler.submit(async () => prepared())).toThrow(
      "frame-scheduler-full",
    );
    encodeA.resolve(a);
    await startedB.promise;
    expect(slots).toEqual([1, 2]);
    validationB.resolve();
    await Promise.resolve();
    expect(b.publish).not.toHaveBeenCalled();
    validationA.resolve();
    expect(await first).toEqual({ status: "fulfilled", slot: 1 });
    expect(await second).toEqual({ status: "fulfilled", slot: 2 });
    expect(a.publish.mock.invocationCallOrder[0]).toBeLessThan(
      b.publish.mock.invocationCallOrder[0]!,
    );
    expect(scheduler.frontSlot).toBe(2);
  });
  it("preserves the last committed front when later validation fails", async () => {
    const scheduler = new NativeBoundedFrameScheduler();
    const failure = new Error("invalid-second-frame");
    const validation = deferred<void>();
    const b = prepared(validation.promise);
    const first = scheduler.submit(async () => prepared());
    const second = scheduler.submit(async () => b);
    await first;
    validation.reject(failure);
    expect(await second).toEqual({
      status: "rejected",
      slot: 2,
      reason: failure,
    });
    expect(scheduler.frontSlot).toBe(1);
    expect(b.publish).not.toHaveBeenCalled();
    expect(b.reject).toHaveBeenCalledExactlyOnceWith(failure);
    expect(await scheduler.drain()).toHaveLength(2);
  });
  it("retains bounded outcomes until explicitly consumed and reuses only nonfront slots", async () => {
    const scheduler = new NativeBoundedFrameScheduler();
    await scheduler.submit(async () => prepared());
    await scheduler.submit(async () => prepared());
    expect(scheduler.pendingCount).toBe(0);
    expect(scheduler.canSubmit).toBe(false);
    expect(() => scheduler.submit(async () => prepared())).toThrow(
      "frame-scheduler-full",
    );
    expect(scheduler.takeOutcomes()).toHaveLength(2);
    expect(scheduler.canSubmit).toBe(true);
    const previousFront = scheduler.frontSlot;
    let slot = -1;
    await scheduler.submit(async (value) => {
      slot = value;
      return prepared();
    });
    expect(slot).not.toBe(previousFront);
    expect(scheduler.frontSlot).toBe(slot);
  });
  it("preserves prepare failures and does not call cleanup for an unprepared job", async () => {
    const scheduler = new NativeBoundedFrameScheduler();
    const failure = new Error("prepare-failed");
    const first = scheduler.submit(async () => {
      throw failure;
    });
    const second = scheduler.submit(async () => prepared());
    expect(await first).toEqual({
      status: "rejected",
      slot: 1,
      reason: failure,
    });
    expect((await second).status).toBe("fulfilled");
    expect((await scheduler.drain())[0]).toEqual({
      status: "rejected",
      slot: 1,
      reason: failure,
    });
  });
  it("retains the primary failure and a failed rejection cleanup", async () => {
    const scheduler = new NativeBoundedFrameScheduler();
    const primary = new Error("publish-failed");
    const cleanup = new Error("rollback-failed");
    const frame = prepared();
    frame.publish.mockRejectedValue(primary);
    frame.reject.mockRejectedValue(cleanup);
    const outcome = await scheduler.submit(async () => frame);
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected")
      throw new Error("Expected rejected fixture");
    expect(outcome.reason).toBeInstanceOf(NativeBoundedFrameSchedulerError);
    expect(outcome.reason).toMatchObject({
      code: "frame-scheduler-cleanup-failed",
      reason: primary,
      cleanupReason: cleanup,
    });
    expect(frame.reject).toHaveBeenCalledTimes(1);
    expect(scheduler.frontSlot).toBe(0);
  });
  it("cancels pending work before publication and never starts queued encoding", async () => {
    const scheduler = new NativeBoundedFrameScheduler();
    const gate = deferred<ReturnType<typeof prepared>>();
    const started = deferred<void>();
    const frame = prepared();
    const first = scheduler.submit(async () => {
      started.resolve();
      return gate.promise;
    });
    const later = vi.fn(async () => prepared());
    const second = scheduler.submit(later);
    await started.promise;
    const reason = new Error("source-changed");
    scheduler.cancel(reason);
    gate.resolve(frame);
    expect((await first).status).toBe("rejected");
    expect((await second).status).toBe("rejected");
    expect(later).not.toHaveBeenCalled();
    expect(frame.publish).not.toHaveBeenCalled();
    expect(frame.reject).toHaveBeenCalledTimes(1);
    expect(scheduler.frontSlot).toBe(0);
    expect(scheduler.canSubmit).toBe(false);
    expect(() => scheduler.submit(async () => prepared())).toThrow(
      "frame-scheduler-cancelled",
    );
    expect(await scheduler.drain()).toHaveLength(2);
  });
  it("does not preempt an already invoked atomic publication", async () => {
    const scheduler = new NativeBoundedFrameScheduler();
    const entered = deferred<void>();
    const finish = deferred<void>();
    const frame = prepared();
    frame.publish.mockImplementation(async () => {
      entered.resolve();
      await finish.promise;
    });
    const outcome = scheduler.submit(async () => frame);
    await entered.promise;
    scheduler.cancel("stop-after-current");
    finish.resolve();
    expect(await outcome).toEqual({ status: "fulfilled", slot: 1 });
    expect(frame.reject).not.toHaveBeenCalled();
    expect(scheduler.frontSlot).toBe(1);
  });
  it("drains a finite snapshot without reporting outcomes already explicitly consumed", async () => {
    const scheduler = new NativeBoundedFrameScheduler();
    const completion = scheduler.submit(async () => prepared());
    await completion;
    expect(scheduler.takeOutcomes()).toHaveLength(1);
    expect(await scheduler.drain()).toEqual([]);
  });
});

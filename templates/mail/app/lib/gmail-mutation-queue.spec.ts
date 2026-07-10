import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.fn();

vi.mock("@agent-native/core/client", () => ({
  callAction: (...args: unknown[]) => callAction(...args),
}));

import { gmailMutationQueue } from "./gmail-mutation-queue";

describe("gmailMutationQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    callAction.mockReset();
    callAction.mockResolvedValue("ok");
    gmailMutationQueue.resetForTests();
    gmailMutationQueue.setDebounceMs(200);
  });

  afterEach(() => {
    gmailMutationQueue.resetForTests();
    vi.useRealTimers();
  });

  it("coalesces rapid archive ops into one batchModify-style action call", async () => {
    const p1 = gmailMutationQueue.enqueue("archive", {
      id: "m1",
      threadId: "t1",
      accountEmail: "a@x.com",
    });
    const p2 = gmailMutationQueue.enqueue("archive", {
      id: "m2",
      threadId: "t2",
      accountEmail: "a@x.com",
    });
    const p3 = gmailMutationQueue.enqueue("archive", {
      id: "m3",
      threadId: "t3",
      accountEmail: "b@x.com",
    });

    expect(gmailMutationQueue.size()).toBe(3);
    expect(callAction).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([p1, p2, p3]);

    expect(callAction).toHaveBeenCalledTimes(1);
    expect(callAction).toHaveBeenCalledWith("archive-email", {
      id: "m1,m2,m3",
      threadIds: "t1,t2,t3",
      accountEmails: "a@x.com,a@x.com,b@x.com",
      removeLabel: undefined,
    });
  });

  it("replaces a duplicate pending archive for the same message", async () => {
    const first = gmailMutationQueue.enqueue("archive", {
      id: "m1",
      threadId: "t1",
    });
    const second = gmailMutationQueue.enqueue("archive", {
      id: "m1",
      threadId: "t1",
    });

    expect(gmailMutationQueue.size()).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([first, second]);
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(callAction.mock.calls[0][1].id).toBe("m1");
  });

  it("batches mark-read and archive separately when both are pending", async () => {
    const a = gmailMutationQueue.enqueue("archive", {
      id: "m1",
      threadId: "t1",
    });
    const r = gmailMutationQueue.enqueue("mark-read", {
      id: "m2",
      threadId: "t2",
      flag: true,
    });

    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([a, r]);

    expect(callAction).toHaveBeenCalledTimes(2);
    const actions = callAction.mock.calls.map((c) => c[0]).sort();
    expect(actions).toEqual(["archive-email", "mark-read"]);
  });

  it("cancel drops a pending archive before flush", async () => {
    const pending = gmailMutationQueue.enqueue("archive", {
      id: "m1",
      threadId: "t1",
    });
    expect(gmailMutationQueue.cancel("archive", "m1")).toBe(true);
    expect(gmailMutationQueue.size()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(callAction).not.toHaveBeenCalled();
  });

  it("rejects waiters when the flush action fails", async () => {
    callAction.mockRejectedValueOnce(new Error("rate limited"));
    const pending = gmailMutationQueue.enqueue("archive", {
      id: "m1",
      threadId: "t1",
    });
    const expectation = expect(pending).rejects.toThrow("rate limited");
    await vi.advanceTimersByTimeAsync(200);
    await expectation;
  });

  it("flushes on max-wait even if debounce keeps resetting", async () => {
    gmailMutationQueue.setDebounceMs(500);
    const first = gmailMutationQueue.enqueue("archive", {
      id: "m1",
      threadId: "t1",
    });
    // Keep resetting debounce every 400ms, but max-wait is 1200ms.
    await vi.advanceTimersByTimeAsync(400);
    const second = gmailMutationQueue.enqueue("archive", {
      id: "m2",
      threadId: "t2",
    });
    await vi.advanceTimersByTimeAsync(400);
    const third = gmailMutationQueue.enqueue("archive", {
      id: "m3",
      threadId: "t3",
    });
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all([first, second, third]);
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(callAction.mock.calls[0][1].id).toBe("m1,m2,m3");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.fn();

vi.mock("@agent-native/core/client/hooks", () => ({
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
    let firstSettled = false;
    void first.then(() => {
      firstSettled = true;
    });
    await vi.advanceTimersByTimeAsync(199);
    expect(firstSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
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
    expect(callAction).toHaveBeenCalledWith("mark-read", {
      id: "m2",
      accountEmails: "",
      unread: false,
    });
  });

  it("forwards every selected message ID when marking a multi-message thread read", async () => {
    const pending = ["m1", "m2", "m3"].map((id) =>
      gmailMutationQueue.enqueue("mark-read", {
        id,
        threadId: "thread-1",
        accountEmail: "a@x.com",
        flag: true,
      }),
    );

    await vi.advanceTimersByTimeAsync(200);
    await Promise.all(pending);

    expect(callAction).toHaveBeenCalledTimes(1);
    expect(callAction).toHaveBeenCalledWith("mark-read", {
      id: "m1,m2,m3",
      accountEmails: "a@x.com,a@x.com,a@x.com",
      threadIds: "thread-1,thread-1,thread-1",
      unread: false,
    });
  });

  it("retries quota-deferred selected thread reads together", async () => {
    callAction
      .mockResolvedValueOnce({
        requested: ["m1", "m2", "m3"],
        succeeded: ["m1"],
        failed: [],
        remaining: ["m2", "m3"],
        retryAfterSeconds: 1,
      })
      .mockResolvedValueOnce("Marked 2/2 email(s) as read");
    const pending = ["m1", "m2", "m3"].map((id) =>
      gmailMutationQueue.enqueue("mark-read", {
        id,
        threadId: `thread-${id}`,
        accountEmail: "a@x.com",
        flag: true,
      }),
    );

    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all(pending);

    expect(callAction).toHaveBeenCalledTimes(2);
    expect(callAction.mock.calls[1]).toEqual([
      "mark-read",
      {
        id: "m2,m3",
        accountEmails: "a@x.com,a@x.com",
        threadIds: "thread-m2,thread-m3",
        unread: false,
      },
    ]);
  });

  it("retries only quota-deferred stars as one batch after the cooldown", async () => {
    callAction
      .mockResolvedValueOnce({
        requested: ["m1", "m2", "m3"],
        succeeded: ["m1"],
        failed: [],
        remaining: ["m2", "m3"],
        retryAfterSeconds: 2,
      })
      .mockResolvedValueOnce({
        requested: ["m2", "m3"],
        succeeded: ["m2", "m3"],
        failed: [],
        remaining: [],
      });
    const pending = ["m1", "m2", "m3"].map((id) =>
      gmailMutationQueue.enqueue("star", {
        id,
        accountEmail: "a@x.com",
      }),
    );

    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(callAction).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(pending);

    expect(callAction).toHaveBeenCalledTimes(2);
    expect(callAction.mock.calls.map(([action]) => action)).toEqual([
      "star-email",
      "star-email",
    ]);
    expect(callAction.mock.calls[1][1]).toEqual({
      id: "m2,m3",
      threadIds: ",",
      accountEmails: "a@x.com,a@x.com",
      unstar: false,
    });
  });

  it("batches trash and settles partial per-item results from one action call", async () => {
    callAction.mockResolvedValueOnce({
      requested: ["m1", "m2"],
      succeeded: ["m1"],
      failed: [{ id: "m2", error: "provider unavailable" }],
    });
    const first = gmailMutationQueue.enqueue("trash", {
      id: "m1",
      threadId: "t1",
      accountEmail: "a@x.com",
    });
    const second = gmailMutationQueue.enqueue("trash", {
      id: "m2",
      threadId: "t2",
      accountEmail: "b@x.com",
    });
    const secondError = expect(second).rejects.toThrow("provider unavailable");

    await vi.advanceTimersByTimeAsync(200);

    await expect(first).resolves.toBeUndefined();
    await secondError;
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(callAction).toHaveBeenCalledWith("trash-email", {
      id: "m1,m2",
      threadIds: "t1,t2",
      accountEmails: "a@x.com,b@x.com",
    });
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

  it("waits for an in-flight archive before allowing its inverse", async () => {
    let resolveAction!: (value: string) => void;
    callAction.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveAction = resolve;
      }),
    );
    const pending = gmailMutationQueue.enqueue("archive", {
      id: "m1",
      threadId: "t1",
    });

    await vi.advanceTimersByTimeAsync(200);
    const waiting = gmailMutationQueue.cancelOrWait("archive", "m1");
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveAction("ok");
    await expect(waiting).resolves.toBe("succeeded");
    await expect(pending).resolves.toBeUndefined();
    expect(callAction).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight trash before allowing its inverse", async () => {
    let resolveAction!: (value: string) => void;
    callAction.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveAction = resolve;
      }),
    );
    const pending = gmailMutationQueue.enqueue("trash", { id: "m1" });

    await vi.advanceTimersByTimeAsync(200);
    const waiting = gmailMutationQueue.cancelOrWait("trash", "m1");
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveAction("Trashed 1 email(s) successfully");
    await expect(waiting).resolves.toBe("succeeded");
    await expect(pending).resolves.toBeUndefined();
    expect(callAction).toHaveBeenCalledTimes(1);
  });

  it("retries each item when a bulk flush fails", async () => {
    callAction.mockRejectedValueOnce(new Error("rate limited"));
    const pending = gmailMutationQueue.enqueue("archive", {
      id: "m1",
      threadId: "t1",
    });
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(callAction).toHaveBeenCalledTimes(2);
    expect(callAction.mock.calls[1]).toEqual([
      "archive-email",
      {
        id: "m1",
        threadId: "t1",
        accountEmail: undefined,
        removeLabel: undefined,
      },
    ]);
  });

  it("falls back from partial mark-read results to independent items", async () => {
    callAction
      .mockResolvedValueOnce("Marked 1/2 email(s) as read")
      .mockResolvedValue("Marked 1/1 email(s) as read");
    const first = gmailMutationQueue.enqueue("mark-read", {
      id: "m1",
      accountEmail: "a@x.com",
      flag: true,
    });
    const second = gmailMutationQueue.enqueue("mark-read", {
      id: "m2",
      accountEmail: "a@x.com",
      flag: true,
    });

    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([first, second]);
    expect(callAction).toHaveBeenCalledTimes(3);
    expect(callAction.mock.calls.slice(1).map((call) => call[1].id)).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("flushes on max-wait even if debounce keeps resetting", async () => {
    gmailMutationQueue.setDebounceMs(500);
    const first = gmailMutationQueue.enqueue("archive", {
      id: "m1",
      threadId: "t1",
    });
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
  it("retries quota-deferred archive targets together in one bulk action", async () => {
    callAction
      .mockResolvedValueOnce({
        requested: ["m1", "m2", "m3"],
        succeeded: ["m1"],
        failed: [],
        remaining: ["m2", "m3"],
        retryAfterSeconds: 2,
      })
      .mockResolvedValueOnce("Archived 2 email(s) successfully");
    const first = gmailMutationQueue.enqueue("archive", {
      id: "m1",
      threadId: "t1",
      accountEmail: "a@x.com",
    });
    const second = gmailMutationQueue.enqueue("archive", {
      id: "m2",
      threadId: "t2",
      accountEmail: "a@x.com",
    });
    const third = gmailMutationQueue.enqueue("archive", {
      id: "m3",
      threadId: "t3",
      accountEmail: "a@x.com",
    });

    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(callAction).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second, third]);

    expect(callAction).toHaveBeenCalledTimes(2);
    expect(callAction.mock.calls.map(([action]) => action)).toEqual([
      "archive-email",
      "archive-email",
    ]);
    expect(callAction.mock.calls[1][1]).toEqual({
      id: "m2,m3",
      threadIds: "t2,t3",
      accountEmails: "a@x.com,a@x.com",
      removeLabel: undefined,
    });
  });

  it("continues archive batches while each response makes progress", async () => {
    callAction.mockImplementation(async (_action, args) => {
      const requested = String(args.id).split(",");
      const succeeded = requested.slice(0, 50);
      return {
        requested,
        succeeded,
        failed: [],
        remaining: requested.slice(succeeded.length),
      };
    });
    const targets = Array.from({ length: 251 }, (_, index) =>
      gmailMutationQueue.enqueue("archive", { id: "m" + index }),
    );

    await vi.advanceTimersByTimeAsync(200);
    await Promise.all(targets);

    expect(callAction).toHaveBeenCalledTimes(6);
    expect(
      callAction.mock.calls.map(
        ([, args]) => String(args.id).split(",").length,
      ),
    ).toEqual([251, 201, 151, 101, 51, 1]);
  });

  it("fails a deferred archive batch that makes no progress without a cooldown", async () => {
    callAction.mockResolvedValueOnce({
      requested: ["m1"],
      succeeded: [],
      failed: [],
      remaining: ["m1"],
    });
    const pending = gmailMutationQueue.enqueue("archive", { id: "m1" });
    const rejected = expect(pending).rejects.toThrow(
      "Archive made no progress after retries",
    );

    await vi.advanceTimersByTimeAsync(200);
    await rejected;

    expect(callAction).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to individual archive calls for a quota error", async () => {
    const cooldown = Object.assign(new Error("quota cooldown"), {
      statusCode: 429,
      errorCode: "gmail_quota_cooldown",
      details: { retryAfterSeconds: 1 },
    });
    callAction
      .mockRejectedValueOnce(cooldown)
      .mockResolvedValueOnce("Archived 2 email(s) successfully");
    const first = gmailMutationQueue.enqueue("archive", { id: "m1" });
    const second = gmailMutationQueue.enqueue("archive", { id: "m2" });

    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all([first, second]);

    expect(callAction).toHaveBeenCalledTimes(2);
    expect(callAction.mock.calls.map(([action]) => action)).toEqual([
      "archive-email",
      "archive-email",
    ]);
    expect(callAction.mock.calls[1][1].id).toBe("m1,m2");
  });
});

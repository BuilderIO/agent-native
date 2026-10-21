import { describe, expect, it, vi } from "vitest";

import { scheduleQueuedSubmissionInboxDrain } from "./queued-submission-inbox-drain.js";

describe("scheduleQueuedSubmissionInboxDrain", () => {
  it("hands the drain to waitUntil after a completed turn and skips continuations", async () => {
    const waitUntil = vi.fn();
    const drain = vi.fn(async () => ({ submitted: 1 }));
    const onError = vi.fn();

    scheduleQueuedSubmissionInboxDrain({
      threadId: "thread-1",
      turnContinues: true,
      waitUntil,
      drain,
      onError,
    });
    expect(waitUntil).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();

    scheduleQueuedSubmissionInboxDrain({
      threadId: "thread-1",
      turnContinues: false,
      waitUntil,
      drain,
      onError,
    });
    expect(waitUntil).toHaveBeenCalledOnce();
    await waitUntil.mock.calls[0]?.[0];

    expect(drain).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(onError).not.toHaveBeenCalled();
  });
});

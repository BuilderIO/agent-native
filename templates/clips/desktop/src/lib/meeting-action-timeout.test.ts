import { afterEach, describe, expect, it, vi } from "vitest";

import { withMeetingActionTimeout } from "./meeting-action-timeout";

describe("withMeetingActionTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the request and rejects when the deadline expires", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const request = withMeetingActionTimeout(
      (signal) => {
        requestSignal = signal;
        return new Promise<never>(() => {});
      },
      100,
      "Meeting action timed out.",
    );
    const rejected = expect(request).rejects.toThrow(
      "Meeting action timed out.",
    );

    await vi.advanceTimersByTimeAsync(100);

    await rejected;
    expect(requestSignal?.aborted).toBe(true);
  });

  it("clears the deadline when the request succeeds", async () => {
    vi.useFakeTimers();

    await expect(
      withMeetingActionTimeout(async () => "saved", 100, "timed out"),
    ).resolves.toBe("saved");

    expect(vi.getTimerCount()).toBe(0);
  });
});

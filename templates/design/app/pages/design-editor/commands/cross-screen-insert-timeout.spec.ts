// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { scheduleCrossScreenInsertTimeout } from "./cross-screen-insert-timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduleCrossScreenInsertTimeout", () => {
  it("rejects an unacknowledged non-board insert after the board timeout", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    scheduleCrossScreenInsertTimeout(
      {
        requestId: 1,
        transactionId: "move-1",
        screenId: "target",
        html: "<div />",
        anchor: { selector: "body" },
        placement: "inside",
      },
      "board",
      onTimeout,
    );

    vi.advanceTimersByTime(2_199);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith("move-1");
  });

  it("skips the board canvas timeout and cancels a pending insert on ack", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    scheduleCrossScreenInsertTimeout(
      {
        requestId: 1,
        transactionId: "move-1",
        screenId: "board",
        html: "<div />",
        anchor: { selector: "body" },
        placement: "inside",
      },
      "board",
      onTimeout,
    );
    vi.advanceTimersByTime(2_200);
    expect(onTimeout).not.toHaveBeenCalled();

    const cancel = scheduleCrossScreenInsertTimeout(
      {
        requestId: 2,
        transactionId: "move-2",
        screenId: "target",
        html: "<div />",
        anchor: { selector: "body" },
        placement: "inside",
      },
      "board",
      onTimeout,
    );
    cancel();
    vi.advanceTimersByTime(2_200);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

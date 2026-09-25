// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS,
  crossScreenRollbackDisposition,
  scheduleCrossScreenDeleteTimeout,
  scheduleCrossScreenInsertTimeout,
  scheduleCrossScreenRollbackTimeout,
} from "./cross-screen-insert-timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduleCrossScreenDeleteTimeout", () => {
  it("rejects an unacknowledged source delete after insert acknowledgement", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const request = {
      requestId: "move-1:source",
      transactionId: "move-1",
      screenId: "source",
      selector: "#source",
      waitForInsertTransaction: false,
    };
    const cancel = scheduleCrossScreenDeleteTimeout(
      request,
      "board",
      onTimeout,
    );

    vi.advanceTimersByTime(CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith(request);
    cancel();
  });

  it("skips inserts still awaiting their destination and board deletes", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    scheduleCrossScreenDeleteTimeout(
      {
        requestId: "move-1:source",
        transactionId: "move-1",
        screenId: "source",
        selector: "#source",
        waitForInsertTransaction: true,
      },
      "board",
      onTimeout,
    );
    scheduleCrossScreenDeleteTimeout(
      {
        requestId: "move-2:source",
        transactionId: "move-2",
        screenId: "board",
        selector: "#source",
        waitForInsertTransaction: false,
      },
      "board",
      onTimeout,
    );
    vi.advanceTimersByTime(CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe("crossScreenRollbackDisposition", () => {
  it("keeps a partial insert undoable, retains uncertain recovery, and discards resolved work", () => {
    expect(
      crossScreenRollbackDisposition({
        applied: false,
        destinationHasPendingInsert: true,
        destinationScreenExists: true,
      }),
    ).toBe("preserve-insert");
    expect(
      crossScreenRollbackDisposition({
        applied: false,
        destinationHasPendingInsert: false,
        destinationScreenExists: true,
      }),
    ).toBe("retain-recovery");
    expect(
      crossScreenRollbackDisposition({
        applied: true,
        destinationHasPendingInsert: true,
        destinationScreenExists: true,
      }),
    ).toBe("discard");
    expect(
      crossScreenRollbackDisposition({
        applied: false,
        destinationHasPendingInsert: true,
        destinationScreenExists: false,
      }),
    ).toBe("discard");
  });
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

  it("settles a rollback whose destination never acknowledges", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const request = {
      requestId: "move-1:rollback",
      transactionId: "move-1",
      screenId: "target",
      selector: "",
    };
    const cancel = scheduleCrossScreenRollbackTimeout(request, onTimeout);

    vi.advanceTimersByTime(CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith(request);

    cancel();
  });
});

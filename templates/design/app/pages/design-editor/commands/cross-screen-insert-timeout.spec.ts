// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS,
  cancelCrossScreenRollbackTimeout,
  crossScreenSourceCancellationNeedsRetry,
  crossScreenRollbackAfterSourceCancellation,
  crossScreenRollbackIsComplete,
  crossScreenRollbackDisposition,
  crossScreenSourceDeleteCancellation,
  retryCrossScreenRollbackRequest,
  retryCrossScreenDeleteCancellation,
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

  it("times out a canceled source delete when its bridge never acknowledges cancellation", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const request = {
      requestId: "move-1:source",
      transactionId: "move-1",
      screenId: "source",
      selector: "#source",
      waitForInsertTransaction: false,
      cancelRequested: true,
    };
    scheduleCrossScreenDeleteTimeout(request, "board", onTimeout);

    vi.advanceTimersByTime(CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS);

    expect(onTimeout).toHaveBeenCalledExactlyOnceWith(request);
  });

  it("backs off and retries cancellation until the source is confirmed present", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const request = {
      requestId: "move-1:source",
      transactionId: "move-1",
      screenId: "source",
      selector: "#source",
      waitForInsertTransaction: false,
      cancelRequested: true,
    };
    const retry = retryCrossScreenDeleteCancellation(request);

    expect(retry).toMatchObject({
      requestId: "move-1:source",
      cancellationRetryCount: 1,
      cancelRequested: true,
    });
    expect(retryCrossScreenDeleteCancellation(retry)).toMatchObject({
      requestId: "move-1:source",
      cancellationRetryCount: 2,
    });
    const cancel = scheduleCrossScreenDeleteTimeout(retry, "board", onTimeout);

    vi.advanceTimersByTime(CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS * 2 - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith(retry);
    cancel();
  });

  it.each([
    { reason: "source-delete-timeout", sourcePresent: undefined, retry: true },
    { reason: "cancelled", sourcePresent: false, retry: true },
    { reason: "cancelled", sourcePresent: true, retry: false },
  ])(
    "requires confirmed source presence before recovery completes (%o)",
    (result) => {
      expect(crossScreenSourceCancellationNeedsRetry(result)).toBe(
        result.retry,
      );
    },
  );

  it("times out a source cancellation while the destination insert is pending", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const request = {
      requestId: "move-1:source",
      transactionId: "move-1",
      screenId: "source",
      selector: "#source",
      waitForInsertTransaction: true,
      cancelRequested: true,
    };
    scheduleCrossScreenDeleteTimeout(request, "board", onTimeout);

    vi.advanceTimersByTime(CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS);

    expect(onTimeout).toHaveBeenCalledExactlyOnceWith(request);
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

describe("retryCrossScreenRollbackRequest", () => {
  it("retries once with a fresh request id, then settles", () => {
    const request = {
      requestId: "move-1:rollback:1",
      transactionId: "move-1",
      screenId: "target",
      selector: "#inserted",
      sourceId: "inserted-id",
      idempotent: true,
    };

    const retry = retryCrossScreenRollbackRequest(request, "move-1:rollback:2");
    expect(retry).toEqual({
      ...request,
      requestId: "move-1:rollback:2",
      retryCount: 1,
    });
    expect(
      retry && retryCrossScreenRollbackRequest(retry, "move-1:rollback:3"),
    ).toBeNull();
  });
});

describe("crossScreenRollbackAfterSourceCancellation", () => {
  const request = {
    requestId: "move-1:source",
    transactionId: "move-1",
    screenId: "source",
    selector: "#source",
    rollbackScreenId: "target",
    rollbackSelector: "#inserted",
    rollbackSourceId: "inserted-id",
  };

  it("waits for source restoration before rolling back the destination", () => {
    expect(
      crossScreenRollbackAfterSourceCancellation(request, false, "rollback-1"),
    ).toBeNull();
    expect(
      crossScreenRollbackAfterSourceCancellation(request, true, "rollback-1"),
    ).toEqual({
      screenId: "target",
      requestId: "rollback-1",
      transactionId: "move-1",
      selector: "#inserted",
      sourceId: "inserted-id",
      idempotent: true,
    });
  });

  it("rolls back a transaction-tagged destination when its selector ack was lost", () => {
    expect(
      crossScreenRollbackAfterSourceCancellation(
        {
          requestId: "move-1:source",
          transactionId: "move-1",
          screenId: "source",
          selector: "#source",
          rollbackScreenId: "target",
        },
        true,
        "rollback-1",
      ),
    ).toEqual({
      screenId: "target",
      requestId: "rollback-1",
      transactionId: "move-1",
      selector: "",
      sourceId: undefined,
      idempotent: true,
    });
  });
});

describe("cross-screen destination failure recovery", () => {
  it("restores the source and keeps an idempotent destination rollback for bridge recovery", () => {
    const sourceDeleteAfterInsertAck = {
      requestId: "move-1:source",
      transactionId: "move-1",
      screenId: "source",
      selector: "#source",
      waitForInsertTransaction: false,
      rollbackScreenId: "target",
      rollbackSelector: "#inserted",
      rollbackSourceId: "inserted-id",
    };

    const cancellation = crossScreenSourceDeleteCancellation(
      sourceDeleteAfterInsertAck,
      "move-1",
    );
    expect(cancellation).toEqual({
      ...sourceDeleteAfterInsertAck,
      cancelRequested: true,
    });
    expect(
      crossScreenSourceDeleteCancellation(sourceDeleteAfterInsertAck, "move-1"),
    ).toEqual(cancellation);
    const sourceDeleteBeforeInsertAck = {
      ...sourceDeleteAfterInsertAck,
      waitForInsertTransaction: true,
      rollbackSelector: undefined,
      rollbackSourceId: undefined,
    };
    expect(
      crossScreenSourceDeleteCancellation(
        sourceDeleteBeforeInsertAck,
        "move-1",
      ),
    ).toEqual({ ...sourceDeleteBeforeInsertAck, cancelRequested: true });

    const rollback = {
      requestId: "move-1:target-unmount-rollback",
      transactionId: "move-1",
      screenId: "target",
      selector: "#inserted",
      sourceId: "inserted-id",
      idempotent: true,
    };
    // If the destination reloaded while unmounted, its transient insertion is
    // already gone. Treat that no-op rollback as complete instead of wedging
    // the transaction and blocking subsequent moves.
    expect(
      crossScreenRollbackIsComplete(rollback!, {
        applied: false,
        reason: "target-unresolved",
      }),
    ).toBe(true);
    expect(
      crossScreenRollbackIsComplete(rollback!, {
        applied: false,
        reason: "target-canvas-unmounted",
      }),
    ).toBe(true);
    expect(
      crossScreenRollbackIsComplete(rollback!, {
        applied: false,
        reason: "ambiguous-target",
      }),
    ).toBe(false);
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

  it("shows one failure toast when a rollback result arrives before its timeout", () => {
    vi.useFakeTimers();
    const toastError = vi.fn();
    const request = {
      requestId: "move-1:rollback",
      transactionId: "move-1",
      screenId: "target",
      selector: "",
    };
    const timeoutRef: { current: (() => void) | null } = { current: null };
    const handleResult = ({ applied }: { applied: boolean }) => {
      cancelCrossScreenRollbackTimeout(timeoutRef);
      if (!applied) toastError();
    };
    timeoutRef.current = scheduleCrossScreenRollbackTimeout(request, () =>
      handleResult({ applied: false }),
    );

    handleResult({ applied: false });
    vi.advanceTimersByTime(CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(timeoutRef.current).toBeNull();
  });
});

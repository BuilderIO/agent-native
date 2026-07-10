import { describe, expect, it, vi } from "vitest";

import { submitDesignAnnotations } from "./annotation-submit";

describe("submitDesignAnnotations", () => {
  it("commits queued pins and exits draw mode after chat accepts the batch", () => {
    const send = vi.fn();
    const markQueuedPinsSubmitted = vi.fn();
    const exitDrawMode = vi.fn();
    const onError = vi.fn();

    expect(
      submitDesignAnnotations({
        message: "annotate this",
        hasQueuedPins: true,
        send,
        markQueuedPinsSubmitted,
        exitDrawMode,
        onError,
      }),
    ).toBe(true);
    expect(send).toHaveBeenCalledWith("annotate this");
    expect(markQueuedPinsSubmitted).toHaveBeenCalledOnce();
    expect(exitDrawMode).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps queued pins and draw mode intact when chat handoff fails", () => {
    const error = new Error("chat unavailable");
    const markQueuedPinsSubmitted = vi.fn();
    const exitDrawMode = vi.fn();
    const onError = vi.fn();

    expect(
      submitDesignAnnotations({
        message: "annotate this",
        hasQueuedPins: true,
        send: () => {
          throw error;
        },
        markQueuedPinsSubmitted,
        exitDrawMode,
        onError,
      }),
    ).toBe(false);
    expect(markQueuedPinsSubmitted).not.toHaveBeenCalled();
    expect(exitDrawMode).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
  });
});

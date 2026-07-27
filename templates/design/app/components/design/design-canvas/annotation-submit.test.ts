import { describe, expect, it, vi } from "vitest";

import { submitDesignAnnotations } from "./annotation-submit";

describe("submitDesignAnnotations", () => {
  it("commits queued pins and exits draw mode after chat accepts the batch", async () => {
    const send = vi.fn();
    const markQueuedPinsSubmitted = vi.fn();
    const exitDrawMode = vi.fn();
    const onError = vi.fn();

    await expect(
      submitDesignAnnotations({
        message: "annotate this",
        hasQueuedPins: true,
        send,
        markQueuedPinsSubmitted,
        exitDrawMode,
        onError,
      }),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith("annotate this");
    expect(markQueuedPinsSubmitted).toHaveBeenCalledOnce();
    expect(exitDrawMode).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not clear annotation work while delivery confirmation is pending", async () => {
    let confirmDelivery!: () => void;
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          confirmDelivery = resolve;
        }),
    );
    const markQueuedPinsSubmitted = vi.fn();
    const exitDrawMode = vi.fn();
    const onError = vi.fn();

    const submission = submitDesignAnnotations({
      message: "annotate this",
      hasQueuedPins: true,
      send,
      markQueuedPinsSubmitted,
      exitDrawMode,
      onError,
    });
    expect(markQueuedPinsSubmitted).not.toHaveBeenCalled();
    expect(exitDrawMode).not.toHaveBeenCalled();

    confirmDelivery();
    await expect(submission).resolves.toBe(true);
    expect(markQueuedPinsSubmitted).toHaveBeenCalledOnce();
    expect(exitDrawMode).toHaveBeenCalledOnce();
  });

  it("keeps queued pins and draw mode intact when chat handoff throws synchronously", async () => {
    const error = new Error("chat unavailable");
    const markQueuedPinsSubmitted = vi.fn();
    const exitDrawMode = vi.fn();
    const onError = vi.fn();

    await expect(
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
    ).resolves.toBe(false);
    expect(markQueuedPinsSubmitted).not.toHaveBeenCalled();
    expect(exitDrawMode).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("keeps queued pins and draw mode intact when delivery is not confirmed (silent drop)", async () => {
    // Mirrors sendToAgentChatAndConfirm resolving `delivered: false` (e.g. no
    // LLM/agent engine configured) — the caller turns that into a rejection
    // instead of resolving silently, so the annotation work is never lost.
    const markQueuedPinsSubmitted = vi.fn();
    const exitDrawMode = vi.fn();
    const onError = vi.fn();

    await expect(
      submitDesignAnnotations({
        message: "annotate this",
        hasQueuedPins: true,
        send: async () => {
          throw new Error(
            "Message was not delivered to the agent chat (missing-engine)",
          );
        },
        markQueuedPinsSubmitted,
        exitDrawMode,
        onError,
      }),
    ).resolves.toBe(false);
    expect(markQueuedPinsSubmitted).not.toHaveBeenCalled();
    expect(exitDrawMode).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });
});

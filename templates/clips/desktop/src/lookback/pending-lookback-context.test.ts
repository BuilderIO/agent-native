import { describe, expect, it, vi } from "vitest";

import type { RecordingContextItem } from "./context-api";
import {
  isLookbackContextAwaitingStop,
  settlePendingLookbackContextAfterStop,
  takePendingLookbackContext,
  takePendingLookbackContextAfterStop,
  type PendingLookbackContext,
} from "./pending-lookback-context";

function pending(recordingId: string): PendingLookbackContext {
  return {
    recordingId,
    target: { serverUrl: "https://clips.example.test", authToken: "" },
    item: Promise.resolve(null),
  };
}

function pendingWithItem(recordingId: string): PendingLookbackContext {
  return {
    ...pending(recordingId),
    item: Promise.resolve({ id: "context-1" } as RecordingContextItem),
  };
}

describe("takePendingLookbackContext", () => {
  it("removes only the failed recording's cleanup handle", () => {
    const failed = pending("recording-a");
    const newer = pending("recording-b");
    const contexts = new Map([
      [failed.recordingId, failed],
      [newer.recordingId, newer],
    ]);

    expect(takePendingLookbackContext(contexts, failed.recordingId)).toBe(
      failed,
    );
    expect(contexts.get(newer.recordingId)).toBe(newer);
    expect(takePendingLookbackContext(contexts, failed.recordingId)).toBeNull();
  });
});

describe("takePendingLookbackContextAfterStop", () => {
  it("releases only the retained recording's handle after its stop settles", () => {
    const retained = pending("recording-a");
    const newer = pending("recording-b");
    const contexts = new Map([
      [retained.recordingId, retained],
      [newer.recordingId, newer],
    ]);

    expect(
      takePendingLookbackContextAfterStop(
        contexts,
        retained.recordingId,
        newer.recordingId,
      ),
    ).toBeNull();
    expect(contexts.get(retained.recordingId)).toBe(retained);
    expect(
      takePendingLookbackContextAfterStop(
        contexts,
        retained.recordingId,
        retained.recordingId,
      ),
    ).toBe(retained);
    expect(contexts.get(newer.recordingId)).toBe(newer);
  });
});

describe("settlePendingLookbackContextAfterStop", () => {
  it("removes the server request when recording stop fails", async () => {
    const context = pendingWithItem("recording-a");
    const contexts = new Map([[context.recordingId, context]]);
    const removeItem = vi.fn(async () => {});

    await settlePendingLookbackContextAfterStop(
      contexts,
      context.recordingId,
      false,
      removeItem,
    );

    expect(removeItem).toHaveBeenCalledWith(context.target, "context-1");
    expect(contexts.has(context.recordingId)).toBe(false);
  });

  it("keeps failed-stop context unavailable to the worker until removal succeeds", async () => {
    const context = pendingWithItem("recording-a");
    const contexts = new Map([[context.recordingId, context]]);
    const removeItem = vi
      .fn(
        async (_target: PendingLookbackContext["target"], _itemId: string) =>
          undefined,
      )
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(
      settlePendingLookbackContextAfterStop(
        contexts,
        context.recordingId,
        false,
        removeItem,
      ),
    ).rejects.toThrow("network unavailable");

    expect(isLookbackContextAwaitingStop(contexts, context.recordingId)).toBe(
      true,
    );

    await settlePendingLookbackContextAfterStop(
      contexts,
      context.recordingId,
      false,
      removeItem,
    );

    expect(removeItem).toHaveBeenCalledTimes(2);
    expect(isLookbackContextAwaitingStop(contexts, context.recordingId)).toBe(
      false,
    );
  });

  it("keeps the server request when recording stop succeeded", async () => {
    const context = pendingWithItem("recording-a");
    const contexts = new Map([[context.recordingId, context]]);
    const removeItem = vi.fn(async () => {});

    await settlePendingLookbackContextAfterStop(
      contexts,
      context.recordingId,
      true,
      removeItem,
    );

    expect(removeItem).not.toHaveBeenCalled();
    expect(contexts.has(context.recordingId)).toBe(false);
  });

  it("releases the cleanup handle when the request never reached the server", async () => {
    const context = pending("recording-a");
    const contexts = new Map([[context.recordingId, context]]);
    const removeItem = vi.fn(async () => {});

    await settlePendingLookbackContextAfterStop(
      contexts,
      context.recordingId,
      false,
      removeItem,
    );

    expect(removeItem).not.toHaveBeenCalled();
    expect(contexts.has(context.recordingId)).toBe(false);
  });
});

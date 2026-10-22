import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecordingContextItem } from "./context-api";
import {
  hasPendingFailedLookbackRemoval,
  isLookbackContextAwaitingStop,
  pendingSuccessfulLookbackRequests,
  pendingFailedLookbackContexts,
  settlePendingLookbackContextAfterStop,
  takePendingLookbackContext,
  takePendingLookbackContextAfterStop,
  type PendingLookbackContext,
} from "./pending-lookback-context";

afterEach(() => {
  vi.restoreAllMocks();
});

function pending(recordingId: string): PendingLookbackContext {
  return {
    recordingId,
    request: {
      recordingId,
      seconds: 300,
      endedAt: "2026-10-15T12:00:00.000Z",
      deviceId: "device-1",
    },
    target: { serverUrl: "https://clips.example.test", authToken: "" },
    account: "person@example.test",
    item: Promise.resolve(null),
  };
}

function pendingWithItem(recordingId: string): PendingLookbackContext {
  return {
    ...pending(recordingId),
    item: Promise.resolve({ id: "context-1" } as RecordingContextItem),
  };
}

describe("hasPendingFailedLookbackRemoval", () => {
  it("reports whether a failed stop still needs server cleanup", () => {
    const failed = pending("recording-a");
    const newer = pending("recording-b");
    failed.stopFailed = true;
    const contexts = new Map([
      [failed.recordingId, failed],
      [newer.recordingId, newer],
    ]);

    expect(hasPendingFailedLookbackRemoval(contexts)).toBe(true);

    contexts.delete(failed.recordingId);
    expect(hasPendingFailedLookbackRemoval(contexts)).toBe(false);
  });

  it("scopes the warning to the current server and account", () => {
    const context = pendingWithItem("recording-a");
    context.stopFailed = true;
    const contexts = new Map([[context.recordingId, context]]);

    expect(
      hasPendingFailedLookbackRemoval(contexts, {
        serverUrl: "https://clips.example.test/another-path",
        account: "PERSON@example.test",
      }),
    ).toBe(true);
    expect(
      hasPendingFailedLookbackRemoval(contexts, {
        serverUrl: "https://clips.other.test",
        account: "person@example.test",
      }),
    ).toBe(false);
    expect(
      hasPendingFailedLookbackRemoval(contexts, {
        serverUrl: "https://clips.example.test",
        account: "other@example.test",
      }),
    ).toBe(false);
  });

  it("retries failed removals only for the current server and account", () => {
    const context = pendingWithItem("recording-a");
    context.stopFailed = true;
    const contexts = new Map([[context.recordingId, context]]);

    expect(
      pendingFailedLookbackContexts(contexts, {
        serverUrl: "https://clips.example.test",
        account: "other@example.test",
      }),
    ).toEqual([]);
    expect(
      pendingFailedLookbackContexts(contexts, {
        serverUrl: "https://clips.example.test",
        account: "person@example.test",
      }),
    ).toEqual([context]);
  });
});

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
  it("persists cleanup intent before waiting for the context response", async () => {
    const context = pending("recording-a");
    let resolveItem!: (item: RecordingContextItem) => void;
    context.item = new Promise((resolve) => {
      resolveItem = resolve;
    });
    const contexts = new Map([[context.recordingId, context]]);
    const events: string[] = [];
    const settling = settlePendingLookbackContextAfterStop(
      contexts,
      context.recordingId,
      false,
      async () => {
        events.push("remove");
      },
      {
        persistIntent: (_context, itemId) =>
          events.push(itemId ? `intent:${itemId}` : "intent:recording"),
        persistRemovalItem: (_context, itemId) =>
          events.push(`queue:${itemId}`),
        clearIntent: () => events.push("clear-intent"),
      },
    );

    expect(events).toEqual(["intent:recording"]);
    resolveItem({ id: "context-1" } as RecordingContextItem);
    await settling;

    expect(events).toEqual([
      "intent:recording",
      "intent:context-1",
      "queue:context-1",
      "clear-intent",
      "remove",
    ]);
  });

  it("releases the context after its durable cleanup intent can recover a rejected request", async () => {
    const context = pending("recording-a");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let rejectItem!: (error: Error) => void;
    context.item = new Promise((_resolve, reject) => {
      rejectItem = reject;
    });
    const contexts = new Map([[context.recordingId, context]]);
    const persistIntent = vi.fn();
    const removeItem = vi.fn(async () => {});
    const settling = settlePendingLookbackContextAfterStop(
      contexts,
      context.recordingId,
      false,
      removeItem,
      {
        persistIntent,
        persistRemovalItem: vi.fn(),
        clearIntent: vi.fn(),
      },
    );

    rejectItem(new Error("network unavailable"));
    await settling;

    expect(persistIntent).toHaveBeenCalledOnce();
    expect(contexts.has(context.recordingId)).toBe(false);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("attempts server removal when cleanup storage cannot be written", async () => {
    const context = pending("recording-a");
    let resolveItem!: (item: RecordingContextItem) => void;
    context.item = new Promise((resolve) => {
      resolveItem = resolve;
    });
    const contexts = new Map([[context.recordingId, context]]);
    const removeItem = vi.fn(async () => {});
    const error = new Error("local storage is full");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cleanupLifecycle = {
      persistIntent: vi.fn(() => {
        throw error;
      }),
      persistRemovalItem: vi.fn(() => {
        throw error;
      }),
      clearIntent: vi.fn(),
    };

    const settling = settlePendingLookbackContextAfterStop(
      contexts,
      context.recordingId,
      false,
      removeItem,
      cleanupLifecycle,
    );

    expect(removeItem).not.toHaveBeenCalled();
    resolveItem({ id: "context-1" } as RecordingContextItem);
    await settling;

    expect(log).toHaveBeenCalledTimes(3);
    expect(removeItem).toHaveBeenCalledWith(
      context.target,
      "context-1",
      context.account,
    );
    expect(cleanupLifecycle.clearIntent).not.toHaveBeenCalled();
    expect(contexts.has(context.recordingId)).toBe(false);
  });

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

    expect(removeItem).toHaveBeenCalledWith(
      context.target,
      "context-1",
      "person@example.test",
    );
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
    expect(hasPendingFailedLookbackRemoval(contexts)).toBe(true);
    expect(context.removalItemId).toBe("context-1");

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
    expect(hasPendingFailedLookbackRemoval(contexts)).toBe(false);
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

  it("persists a retry intent before a successful stop request settles", async () => {
    const context = pending("recording-a");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let rejectItem!: (error: Error) => void;
    context.item = new Promise((_resolve, reject) => {
      rejectItem = reject;
    });
    const contexts = new Map([[context.recordingId, context]]);
    const persistIntent = vi.fn();
    const settling = settlePendingLookbackContextAfterStop(
      contexts,
      context.recordingId,
      true,
      vi.fn(async () => {}),
      {
        persistIntent,
        persistRemovalItem: vi.fn(),
        clearIntent: vi.fn(),
      },
    );

    await settling;
    expect(persistIntent).toHaveBeenCalledWith(context, undefined, "retain");
    expect(contexts.get(context.recordingId)).toBe(context);

    rejectItem(new Error("network unavailable"));
    await expect(context.item).rejects.toThrow("network unavailable");

    expect(contexts.has(context.recordingId)).toBe(false);
  });

  it("keeps the request in memory when its retry intent cannot be persisted", async () => {
    const context = pending("recording-a");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectItem!: (error: Error) => void;
    context.item = new Promise((_resolve, reject) => {
      rejectItem = reject;
    });
    const contexts = new Map([[context.recordingId, context]]);
    const settling = settlePendingLookbackContextAfterStop(
      contexts,
      context.recordingId,
      true,
      vi.fn(async () => {}),
      {
        persistIntent: () => {
          throw new Error("storage unavailable");
        },
        persistRemovalItem: vi.fn(),
        clearIntent: vi.fn(),
      },
    );

    await settling;
    rejectItem(new Error("network unavailable"));
    await expect(context.item).rejects.toThrow("network unavailable");

    expect(contexts.get(context.recordingId)).toBe(context);
    expect(pendingSuccessfulLookbackRequests(contexts)).toEqual([context]);
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

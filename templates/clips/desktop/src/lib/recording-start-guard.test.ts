import { describe, expect, it, vi } from "vitest";

import {
  guardRecordingStart,
  RecordingStartCancelledError,
  RecordingStartTimeoutError,
} from "./recording-start-guard";

describe("guardRecordingStart", () => {
  it("resolves a start that finishes before the timeout", async () => {
    await expect(
      guardRecordingStart(Promise.resolve("started"), { timeoutMs: 100 }),
    ).resolves.toBe("started");
  });

  it("cancels a pending start and notifies the caller once", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const onCancel = vi.fn();
      const pending = guardRecordingStart(new Promise(() => {}), {
        signal: controller.signal,
        timeoutMs: 100,
        onCancel,
      });

      controller.abort();

      await expect(pending).rejects.toBeInstanceOf(
        RecordingStartCancelledError,
      );
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a pending start and disposes a late handle", async () => {
    vi.useFakeTimers();
    try {
      let resolveStart!: (value: { cancel: () => void }) => void;
      const lateHandle = { cancel: vi.fn() };
      const onCancel = vi.fn();
      const pending = guardRecordingStart(
        new Promise<{ cancel: () => void }>((resolve) => {
          resolveStart = resolve;
        }),
        {
          timeoutMs: 100,
          onCancel,
          onLateResolve: (handle) => handle.cancel(),
        },
      );
      const rejection = expect(pending).rejects.toBeInstanceOf(
        RecordingStartTimeoutError,
      );

      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(onCancel).toHaveBeenCalledTimes(1);

      resolveStart(lateHandle);
      await Promise.resolve();
      expect(lateHandle.cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

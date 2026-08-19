import { describe, expect, it, vi } from "vitest";

import {
  boundedCleanup,
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

describe("boundedCleanup", () => {
  it("resolves once a quick cleanup invoke settles", async () => {
    await expect(
      boundedCleanup(Promise.resolve("closed"), 100),
    ).resolves.toBeUndefined();
  });

  it("swallows a rejected cleanup invoke", async () => {
    await expect(
      boundedCleanup(Promise.reject(new Error("boom")), 100),
    ).resolves.toBeUndefined();
  });

  // Regression: a "recovery" block that unconditionally awaits a native
  // cleanup invoke (e.g. hide_recording_chrome, show_popover) with only
  // `.catch(() => {})` hangs forever if that invoke never settles — turning
  // one stuck native call into a permanently frozen UI that only an app
  // restart clears. boundedCleanup must give up after its timeout regardless
  // of whether the underlying operation ever resolves.
  it("gives up on a cleanup invoke that never settles", async () => {
    vi.useFakeTimers();
    try {
      const stuckInvoke = new Promise(() => {});
      const done = vi.fn();
      void boundedCleanup(stuckInvoke, 100).then(done);

      await vi.advanceTimersByTimeAsync(100);
      expect(done).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

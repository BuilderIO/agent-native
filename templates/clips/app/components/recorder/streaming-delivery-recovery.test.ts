import { afterEach, describe, expect, it, vi } from "vitest";

import { StreamingDeliveryRecovery } from "./streaming-delivery-recovery";

function setupRecovery(options?: {
  canRecover?: () => boolean;
  recover?: (restartRequired: boolean) => Promise<void>;
}) {
  const fakeWindow = Object.assign(new EventTarget(), {
    setTimeout,
    clearTimeout,
  });
  const fakeDocument = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);

  const recover = vi.fn(options?.recover ?? (async () => {}));
  const onPermanentFailure = vi.fn();
  const onSettled = vi.fn();
  const recovery = new StreamingDeliveryRecovery({
    canRecover: options?.canRecover ?? (() => true),
    recover,
    onPermanentFailure,
    onSettled,
  });

  return { fakeWindow, onPermanentFailure, onSettled, recover, recovery };
}

describe("StreamingDeliveryRecovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("waits for the online event before recovering an offline upload", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { onLine: false });
    const { fakeWindow, recover, recovery } = setupRecovery();

    recovery.pause();
    await vi.advanceTimersByTimeAsync(0);

    expect(recover).not.toHaveBeenCalled();
    expect(recovery.isPaused).toBe(true);

    (navigator as { onLine: boolean }).onLine = true;
    fakeWindow.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(recover).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith(false);
    expect(recovery.isPaused).toBe(false);
  });

  it("retries a temporary upload failure", async () => {
    vi.useFakeTimers();
    const recover = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        Object.assign(new Error("connection lost"), { transport: true }),
      )
      .mockResolvedValueOnce();
    const { fakeWindow, recovery } = setupRecovery({ recover });

    recovery.pause();
    await vi.advanceTimersByTimeAsync(0);

    expect(recover).toHaveBeenCalledOnce();
    expect(recovery.isPaused).toBe(true);

    fakeWindow.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(recover).toHaveBeenCalledTimes(2);
    expect(recovery.isPaused).toBe(false);
  });

  it("passes the provider restart signal to recovery", async () => {
    vi.useFakeTimers();
    const recover = vi.fn(async (_restartRequired: boolean) => {});
    const { recovery } = setupRecovery({ recover });

    recovery.pause(
      Object.assign(new Error("upload session expired"), {
        restartRequired: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(recover).toHaveBeenCalledWith(true);
  });

  it("ends recovery on a permanent failure", async () => {
    vi.useFakeTimers();
    const error = Object.assign(new Error("chunk too large"), { status: 413 });
    const recover = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    const { onPermanentFailure, onSettled, recovery } = setupRecovery({
      recover,
    });

    recovery.pause();
    await vi.advanceTimersByTimeAsync(0);

    expect(onPermanentFailure).toHaveBeenCalledWith(error);
    expect(onSettled).toHaveBeenCalledOnce();
    expect(recovery.isPaused).toBe(false);
  });

  it("fails stop-time delivery when recovery cannot finish", async () => {
    vi.useFakeTimers();
    const recover = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(
        Object.assign(new Error("connection lost"), { transport: true }),
      );
    const { onPermanentFailure, recovery } = setupRecovery({ recover });

    recovery.pause();

    await expect(recovery.drainForStop()).rejects.toThrow(
      "Upload failed while reconnecting.",
    );

    expect(onPermanentFailure).not.toHaveBeenCalled();
    expect(recovery.isPaused).toBe(false);
  });

  it("ignores a recovery attempt from a previous recording", async () => {
    vi.useFakeTimers();
    let resolveRecovery!: () => void;
    const recover = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRecovery = resolve;
        }),
    );
    const { onSettled, recovery } = setupRecovery({ recover });

    recovery.pause();
    await vi.advanceTimersByTimeAsync(0);
    expect(recover).toHaveBeenCalledOnce();

    recovery.reset();
    resolveRecovery();
    await Promise.resolve();

    expect(onSettled).not.toHaveBeenCalled();
    expect(recovery.isPaused).toBe(false);
  });

  it("drains paused delivery when recording stops", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { onLine: false });
    const { recover, recovery } = setupRecovery();

    recovery.pause();
    await vi.advanceTimersByTimeAsync(0);
    await recovery.drainForStop();

    expect(recover).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith(false);
    expect(recovery.isPaused).toBe(false);
  });
});

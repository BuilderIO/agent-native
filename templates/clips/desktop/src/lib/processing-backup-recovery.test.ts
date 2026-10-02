import { describe, expect, it, vi } from "vitest";

import { reconcileProcessingBackup } from "./processing-backup-recovery";

describe("reconcileProcessingBackup", () => {
  it("cleans a backup only after the server reports ready", async () => {
    const onReady = vi.fn(async () => undefined);
    const onUnresolved = vi.fn(async () => undefined);

    await expect(
      reconcileProcessingBackup({
        waitForReady: async () => ({ status: "ready" }),
        onReady,
        onUnresolved,
      }),
    ).resolves.toBe("ready");

    expect(onReady).toHaveBeenCalledOnce();
    expect(onUnresolved).not.toHaveBeenCalled();
  });

  it("deletes a backup at ready only when the server received every byte", async () => {
    const onReady = vi.fn(async () => undefined);
    const onUnresolved = vi.fn(async () => undefined);
    const local = async () => ({ bytes: 100, durationMs: 60_000 });

    await expect(
      reconcileProcessingBackup({
        waitForReady: async () => ({
          status: "ready",
          sourceSizeBytes: 40,
          durationMs: 60_000,
        }),
        local,
        onReady,
        onUnresolved,
      }),
    ).resolves.toBe("unresolved");
    expect(onReady).not.toHaveBeenCalled();
    expect(onUnresolved).toHaveBeenCalledWith(
      expect.stringContaining("40 of 100 source bytes"),
    );

    await expect(
      reconcileProcessingBackup({
        waitForReady: async () => ({ status: "ready" }),
        local,
        onReady,
        onUnresolved,
      }),
    ).resolves.toBe("unresolved");
    expect(onReady).not.toHaveBeenCalled();

    await expect(
      reconcileProcessingBackup({
        waitForReady: async () => ({
          status: "ready",
          sourceSizeBytes: 100,
          durationMs: 60_500,
        }),
        local,
        onReady,
        onUnresolved,
      }),
    ).resolves.toBe("ready");
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("flags terminal failures and timeouts without deleting the backup", async () => {
    const onReady = vi.fn(async () => undefined);
    const onUnresolved = vi.fn(async () => undefined);

    await expect(
      reconcileProcessingBackup({
        waitForReady: async () => null,
        onReady,
        onUnresolved,
      }),
    ).resolves.toBe("unresolved");

    expect(onReady).not.toHaveBeenCalled();
    expect(onUnresolved).toHaveBeenCalledOnce();
  });

  it("flags the backup when status polling itself fails", async () => {
    const pollError = new Error("status unavailable");
    const onPollError = vi.fn();
    const onUnresolved = vi.fn(async () => undefined);

    await expect(
      reconcileProcessingBackup({
        waitForReady: async () => {
          throw pollError;
        },
        onReady: vi.fn(async () => undefined),
        onUnresolved,
        onPollError,
      }),
    ).resolves.toBe("unresolved");

    expect(onPollError).toHaveBeenCalledWith(pollError);
    expect(onUnresolved).toHaveBeenCalledOnce();
  });
});

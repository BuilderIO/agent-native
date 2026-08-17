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

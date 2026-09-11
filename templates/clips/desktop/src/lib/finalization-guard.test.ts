import { describe, expect, it, vi } from "vitest";

import { finalizeAfterDurableBackup } from "./finalization-guard";

describe("finalizeAfterDurableBackup", () => {
  it("keeps the guard until backup durability and finalize settle", async () => {
    const events: string[] = [];
    let resolveBackup!: () => void;
    let resolveFinalize!: (value: string) => void;
    const ensureBackupDurable = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          events.push("backup-started");
          resolveBackup = () => {
            events.push("backup-durable");
            resolve();
          };
        }),
    );
    const attemptFinalize = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          events.push("finalize-attempted");
          resolveFinalize = (value) => {
            events.push("finalize-settled");
            resolve(value);
          };
        }),
    );
    const releaseGuard = vi.fn(() => {
      events.push("guard-released");
    });

    const result = finalizeAfterDurableBackup({
      ensureBackupDurable,
      attemptFinalize,
      releaseGuard,
    });
    expect(events).toEqual(["backup-started"]);

    resolveBackup();
    await Promise.resolve();
    expect(events).toEqual([
      "backup-started",
      "backup-durable",
      "finalize-attempted",
    ]);

    resolveFinalize("ready");
    await expect(result).resolves.toBe("ready");
    expect(events).toEqual([
      "backup-started",
      "backup-durable",
      "finalize-attempted",
      "finalize-settled",
      "guard-released",
    ]);
  });

  it("releases the guard after a failed finalize attempt", async () => {
    const releaseGuard = vi.fn();

    await expect(
      finalizeAfterDurableBackup({
        ensureBackupDurable: async () => {},
        attemptFinalize: async () => {
          throw new Error("offline");
        },
        releaseGuard,
      }),
    ).rejects.toThrow("offline");
    expect(releaseGuard).toHaveBeenCalledOnce();
  });
});

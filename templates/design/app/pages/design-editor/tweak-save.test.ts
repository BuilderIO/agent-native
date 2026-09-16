import { describe, expect, it, vi } from "vitest";

import {
  classifyTweakSaveFailure,
  clearCompletedTweakSave,
  createQueuedTweakSave,
  rebaseTweakSaveForSend,
  retainLatestFailedTweakSave,
  sendJournaledTweakSaveKeepalive,
} from "./tweak-save";

describe("tweak save ordering", () => {
  it("keeps the first persisted base across a debounced knob gesture", () => {
    const first = createQueuedTweakSave(
      { density: "compact" },
      1,
      "base-a",
      null,
    );
    const second = createQueuedTweakSave(
      { density: "comfortable" },
      2,
      "base-b",
      first,
    );

    expect(second.expectedSelectionsHash).toBe("base-a");
  });

  it("rebases only when a serialized request reaches the send boundary", () => {
    const queued = createQueuedTweakSave(
      { density: "compact" },
      2,
      "old-base",
      null,
    );

    expect(
      rebaseTweakSaveForSend(queued, "verified-predecessor"),
    ).toMatchObject({
      expectedSelectionsHash: "verified-predecessor",
      revision: 2,
    });
  });

  it("retains a failed latest edit but never replaces a newer queued snapshot", () => {
    const failed = createQueuedTweakSave(
      { density: "compact" },
      1,
      "base",
      null,
    );
    const newer = createQueuedTweakSave(
      { density: "comfortable" },
      2,
      "base",
      null,
    );

    expect(retainLatestFailedTweakSave(null, failed)).toBe(failed);
    expect(retainLatestFailedTweakSave(newer, failed)).toBe(newer);
    expect(clearCompletedTweakSave(newer, 1)).toBe(newer);
    expect(clearCompletedTweakSave(newer, 2)).toBeNull();
  });

  it("does not promise a reconnect retry when journaling also failed", () => {
    expect(classifyTweakSaveFailure(new Error("offline"), true)).toBe(
      "durable-retry",
    );
    expect(classifyTweakSaveFailure(new Error("offline"), false)).toBe(
      "tab-memory-only",
    );
    expect(
      classifyTweakSaveFailure(
        Object.assign(new Error("stale"), { status: 409 }),
        true,
      ),
    ).toBe("conflict");
  });

  it("waits for a durable journal before starting the unload keepalive", async () => {
    let resolveJournal!: (journaled: boolean) => void;
    const journal = () =>
      new Promise<boolean>((resolve) => {
        resolveJournal = resolve;
      });
    const send = vi.fn(() => ({
      accepted: true as const,
      completion: Promise.resolve(),
    }));
    const acknowledge = vi.fn(async () => {});
    const keepalive = sendJournaledTweakSaveKeepalive({
      journal,
      send,
      acknowledge,
    });

    expect(send).not.toHaveBeenCalled();
    resolveJournal(true);
    await expect(keepalive).resolves.toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(acknowledge).toHaveBeenCalledOnce();

    await expect(
      sendJournaledTweakSaveKeepalive({
        journal: async () => false,
        send,
        acknowledge,
      }),
    ).resolves.toBe(false);
    expect(send).toHaveBeenCalledOnce();
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it("leaves the durable retry unacknowledged when keepalive fails", async () => {
    const acknowledge = vi.fn(async () => {});

    await expect(
      sendJournaledTweakSaveKeepalive({
        journal: async () => true,
        send: () => ({
          accepted: true,
          completion: Promise.reject(new Error("offline")),
        }),
        acknowledge,
      }),
    ).rejects.toThrow("offline");

    expect(acknowledge).not.toHaveBeenCalled();
  });
});

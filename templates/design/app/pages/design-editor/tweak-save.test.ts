import { describe, expect, it, vi } from "vitest";

import {
  classifyTweakSaveFailure,
  clearCompletedTweakSave,
  createQueuedTweakSave,
  rebaseTweakSaveForSend,
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

  it("clears a queued snapshot only once that revision or a later one lands", () => {
    const newer = createQueuedTweakSave(
      { density: "comfortable" },
      2,
      "base",
      null,
    );

    expect(clearCompletedTweakSave(newer, 1)).toBe(newer);
    expect(clearCompletedTweakSave(newer, 2)).toBeNull();
    expect(clearCompletedTweakSave(newer, 3)).toBeNull();
  });

  it("does not promise a reconnect retry when journaling also failed", () => {
    const networkFailure = new Error(
      "Action apply-tweaks failed: Failed to fetch",
    );
    expect(classifyTweakSaveFailure(networkFailure, true, true)).toBe(
      "durable-retry",
    );
    expect(classifyTweakSaveFailure(networkFailure, false, true)).toBe(
      "not-saved",
    );
    expect(
      classifyTweakSaveFailure(
        Object.assign(new Error("stale"), { status: 409 }),
        true,
        true,
      ),
    ).toBe("conflict");
  });

  it("does not promise a reconnect retry when the server rejects a journaled save", () => {
    expect(
      classifyTweakSaveFailure(
        Object.assign(new Error("Action apply-tweaks failed: Internal error"), {
          status: 500,
        }),
        true,
        true,
      ),
    ).toBe("not-saved");
  });

  it("starts the unload keepalive without waiting for the journal", async () => {
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

    expect(send).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(acknowledge).not.toHaveBeenCalled();
    resolveJournal(true);
    await expect(keepalive).resolves.toBe(true);
    expect(acknowledge).toHaveBeenCalledOnce();

    await expect(
      sendJournaledTweakSaveKeepalive({
        journal: async () => false,
        send,
        acknowledge,
      }),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it("reports a keepalive the browser refused as not sent", async () => {
    const acknowledge = vi.fn(async () => {});
    await expect(
      sendJournaledTweakSaveKeepalive({
        journal: async () => true,
        send: () => ({ accepted: false, completion: null }),
        acknowledge,
      }),
    ).resolves.toBe(false);
    expect(acknowledge).not.toHaveBeenCalled();
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

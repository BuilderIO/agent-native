import { afterEach, describe, expect, it, vi } from "vitest";

import { broadcastOverlayMessage } from "./overlay-broadcast";

describe("broadcastOverlayMessage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("continues when a tab never acknowledges its overlay message", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => new Promise<never>(() => {}));
    const broadcast = broadcastOverlayMessage(
      async () => [1, 2],
      send,
      { type: "CLIPS_OVERLAY_MOUNT" },
      25,
    );

    await vi.advanceTimersByTimeAsync(25);

    await expect(broadcast).resolves.toBe("timed-out");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not deliver a stale mount when tab discovery finishes after timeout", async () => {
    vi.useFakeTimers();
    let finishDiscovery!: (tabIds: readonly number[]) => void;
    const send = vi.fn(async () => true);
    const broadcast = broadcastOverlayMessage(
      () =>
        new Promise<readonly number[]>((resolve) => {
          finishDiscovery = resolve;
        }),
      send,
      { type: "CLIPS_OVERLAY_MOUNT" },
      25,
    );

    await vi.advanceTimersByTimeAsync(25);
    await expect(broadcast).resolves.toBe("timed-out");

    finishDiscovery([1]);
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  });

  it("reports normal delivery and clears its deadline", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => true);

    await expect(
      broadcastOverlayMessage(
        async () => [1],
        send,
        { type: "CLIPS_OVERLAY_UNMOUNT" },
        25,
      ),
    ).resolves.toBe("complete");
    expect(send).toHaveBeenCalledWith(1, { type: "CLIPS_OVERLAY_UNMOUNT" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

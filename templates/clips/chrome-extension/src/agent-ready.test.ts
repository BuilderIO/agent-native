import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForAgentReady } from "./agent-ready";

const options = {
  timeoutMs: 30_000,
  timeoutMessage: "Recorder did not acknowledge capture within 30 seconds.",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("agent recorder readiness", () => {
  it("returns the recorder's acknowledgement once it arrives", async () => {
    vi.useFakeTimers();
    let ready: { startedAtMs: number } | null = null;
    const waiting = waitForAgentReady(
      () => ready,
      new AbortController().signal,
      options,
    );
    await vi.advanceTimersByTimeAsync(250);
    ready = { startedAtMs: 42 };
    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).resolves.toEqual({ startedAtMs: 42 });
  });

  it("stops waiting as soon as the take is stopped", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const read = vi.fn(() => null);
    const waiting = waitForAgentReady(read, controller.signal, {
      ...options,
      pollMs: 60_000,
    });
    const settled = waiting.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await settled).toMatchObject({ name: "AbortError" });

    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a readiness failure the recorder raises", async () => {
    await expect(
      waitForAgentReady(
        () => {
          throw new Error("Recorder readiness was lost.");
        },
        new AbortController().signal,
        options,
      ),
    ).rejects.toThrow("Recorder readiness was lost.");
  });

  it("gives up when the recorder never acknowledges", async () => {
    vi.useFakeTimers();
    const waiting = waitForAgentReady(
      () => null,
      new AbortController().signal,
      options,
    );
    const settled = waiting.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_200);
    expect(await settled).toMatchObject({ message: options.timeoutMessage });
  });
});

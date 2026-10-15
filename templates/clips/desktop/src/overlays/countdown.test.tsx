// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  emit: vi.fn<(name: string, payload?: unknown) => Promise<void>>(),
  focusChanged: undefined as
    | ((event: { payload: boolean }) => void)
    | undefined,
  isVisible: false,
  unlistenFocus: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: mocks.close,
    isVisible: vi.fn(async () => mocks.isVisible),
    onFocusChanged: vi.fn(
      async (callback: (event: { payload: boolean }) => void) => {
        mocks.focusChanged = callback;
        return mocks.unlistenFocus;
      },
    ),
  }),
}));

import { Countdown } from "./countdown";

describe("Countdown", () => {
  let host: HTMLDivElement;
  let root: Root;
  const animationFrames = new Map<number, FrameRequestCallback>();
  let nextAnimationFrame = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.focusChanged = undefined;
    mocks.isVisible = false;
    animationFrames.clear();
    nextAnimationFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const handle = ++nextAnimationFrame;
      animationFrames.set(handle, callback);
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      animationFrames.delete(handle);
    });
    mocks.emit.mockResolvedValue(undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Countdown attemptId="countdown-attempt" />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    animationFrames.clear();
  });

  async function advanceAnimationFrame() {
    const callbacks = [...animationFrames.values()];
    animationFrames.clear();
    await act(async () => {
      for (const callback of callbacks) callback(0);
    });
  }

  it("waits for a painted frame, then advances each countdown number in order", async () => {
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      [...host.querySelectorAll(".countdown-number")].map((node) =>
        node.textContent?.trim(),
      ),
    ).toEqual(["3", "2", "1"]);
    expect(host.querySelector(".countdown-sr-only")?.textContent).toBe("");
    expect(host.querySelector(".countdown-numbers")?.classList).not.toContain(
      "is-running",
    );
    await act(async () => vi.advanceTimersByTimeAsync(2_500));
    expect(host.querySelector(".countdown-numbers")?.classList).not.toContain(
      "is-running",
    );
    expect(mocks.emit).not.toHaveBeenCalledWith(
      "clips:countdown-presented",
      expect.anything(),
    );

    mocks.isVisible = true;
    await act(async () => {
      mocks.focusChanged?.({ payload: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    await advanceAnimationFrame();
    expect(host.querySelector(".countdown-numbers")?.classList).not.toContain(
      "is-running",
    );

    await advanceAnimationFrame();
    expect(host.querySelector(".countdown-numbers")?.classList).toContain(
      "is-running",
    );
    expect(host.querySelector(".countdown-sr-only")?.textContent).toBe("3");
    await advanceAnimationFrame();
    expect(mocks.emit).toHaveBeenCalledWith("clips:countdown-presented", {
      attemptId: "countdown-attempt",
    });

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(host.querySelector(".countdown-sr-only")?.textContent).toBe("2");

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(host.querySelector(".countdown-sr-only")?.textContent).toBe("1");

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(mocks.emit).toHaveBeenCalledWith("clips:countdown-done", {
      attemptId: "countdown-attempt",
      cause: "timer",
    });
  });
});

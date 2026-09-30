// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  emit: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: mocks.close }),
}));

import { Countdown } from "./countdown";

describe("Countdown", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Countdown />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps each countdown number in order until the timer advances", async () => {
    expect(host.querySelector(".countdown-number")?.textContent).toBe("3");

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(host.querySelector(".countdown-number")?.textContent).toBe("2");

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(host.querySelector(".countdown-number")?.textContent).toBe("1");

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(mocks.emit).toHaveBeenCalledWith("clips:countdown-done", {
      cause: "timer",
    });
  });
});

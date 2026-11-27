// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMissingDeckRecheck } from "./use-missing-deck-recheck";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useMissingDeckRecheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-checks when the app becomes visible again after an app switch", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useMissingDeckRecheck({ active: true, autoRetry: false, retry }),
    );
    expect(retry).not.toHaveBeenCalled();

    setVisibility("hidden");
    expect(retry).not.toHaveBeenCalled();
    await act(async () => {
      setVisibility("visible");
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("retries a bounded number of times with backoff, then stops", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useMissingDeckRecheck({
        active: true,
        autoRetry: true,
        retry,
        delaysMs: [100, 200],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(retry).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(retry).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("does nothing while inactive and stops once the deck loads", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ active }) =>
        useMissingDeckRecheck({
          active,
          autoRetry: true,
          retry,
          delaysMs: [100],
        }),
      { initialProps: { active: true } },
    );
    rerender({ active: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      setVisibility("visible");
    });
    expect(retry).not.toHaveBeenCalled();
  });
});

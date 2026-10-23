// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { useCommentAccessRefresh } from "./use-comment-access-refresh";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("refreshes password proof before expiry, rotates it, and stops when no longer unlocked", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const refresh = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe({ token }: { token?: string }) {
    useCommentAccessRefresh(token, refresh);
    return null;
  }
  try {
    act(() => root.render(<Probe token="fake-first-proof" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299_999);
    });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => root.render(<Probe token="fake-rotated-proof" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => root.render(<Probe />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("refreshes when an unlocked tab becomes visible after suspension", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const refresh = vi.fn(async () => {});
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    useCommentAccessRefresh("fake-proof", refresh);
    return null;
  }
  try {
    act(() => root.render(<Probe />));
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    delete (document as any).visibilityState;
  }
});

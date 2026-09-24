// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePollLoop, type UsePollLoopOptions } from "./use-poll-loop.js";

function Probe({
  attempt,
  ...options
}: { attempt: (signal: AbortSignal) => Promise<void> } & UsePollLoopOptions) {
  usePollLoop(attempt, options);
  return null;
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("usePollLoop", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setHidden(false);
  });

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function mount(): ReturnType<typeof createRoot> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    return root;
  }

  it("runs a leading attempt on mount", async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    const root = mount();
    await act(async () =>
      root.render(<Probe attempt={attempt} intervalMs={1000} />),
    );
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("relaxes cadence (does not stop) while hidden by default", async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    const root = mount();
    await act(async () =>
      root.render(<Probe attempt={attempt} intervalMs={1000} />),
    );
    expect(attempt).toHaveBeenCalledTimes(1);

    await act(async () => setHidden(true));
    // Relaxed cadence floors at 10_000ms even though intervalMs is 1000.
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(attempt).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(9000));
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("fully stops and resumes immediately when pauseWhenHidden is true", async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    const root = mount();
    await act(async () =>
      root.render(
        <Probe attempt={attempt} intervalMs={1000} pauseWhenHidden={true} />,
      ),
    );
    expect(attempt).toHaveBeenCalledTimes(1);

    await act(async () => setHidden(true));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(attempt).toHaveBeenCalledTimes(1);

    await act(async () => setHidden(false));
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not run a leading attempt when mounted hidden with pauseWhenHidden", async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    // Hidden before mount — a background restore or prerendered tab.
    setHidden(true);
    const root = mount();
    await act(async () =>
      root.render(
        <Probe attempt={attempt} intervalMs={1000} pauseWhenHidden={true} />,
      ),
    );
    expect(attempt).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(attempt).not.toHaveBeenCalled();

    // Becoming visible is what arms the loop.
    await act(async () => setHidden(false));
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("still runs a leading attempt when mounted hidden without pauseWhenHidden", async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    setHidden(true);
    const root = mount();
    await act(async () =>
      root.render(<Probe attempt={attempt} intervalMs={1000} />),
    );
    // This mode must still reach a backgrounded tab (e.g. notifications).
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("does nothing when enabled is false", async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    const root = mount();
    await act(async () =>
      root.render(
        <Probe attempt={attempt} intervalMs={1000} enabled={false} />,
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(attempt).not.toHaveBeenCalled();
  });

  it("stops on unmount", async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    const root = mount();
    await act(async () =>
      root.render(<Probe attempt={attempt} intervalMs={1000} />),
    );
    expect(attempt).toHaveBeenCalledTimes(1);
    await act(() => root.unmount());
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("never overlaps a slow attempt", async () => {
    let resolveCurrent: (() => void) | undefined;
    const attempt = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveCurrent = resolve)),
      )
      .mockResolvedValue(undefined);
    const root = mount();
    await act(async () =>
      root.render(<Probe attempt={attempt} intervalMs={100} />),
    );
    expect(attempt).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(attempt).toHaveBeenCalledTimes(1);

    resolveCurrent?.();
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});

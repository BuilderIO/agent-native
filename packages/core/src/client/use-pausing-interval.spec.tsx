// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePausingInterval } from "./use-pausing-interval.js";

function Probe({ callback }: { callback: () => Promise<void> }) {
  usePausingInterval(callback, 100, false);
  return null;
}

describe("usePausingInterval", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("never overlaps a slow async polling callback", async () => {
    let resolveCurrent: (() => void) | undefined;
    const callback = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCurrent = resolve;
        }),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => root.render(<Probe callback={callback} />));
    expect(callback).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(callback).toHaveBeenCalledTimes(1);

    resolveCurrent?.();
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(callback).toHaveBeenCalledTimes(2);
  });
});

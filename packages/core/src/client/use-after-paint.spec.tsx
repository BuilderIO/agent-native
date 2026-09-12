// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scheduleAfterPaint, useAfterPaint } from "./use-after-paint.js";

describe("scheduleAfterPaint", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("runs the callback after the paint-aligned window", async () => {
    let ran = false;
    scheduleAfterPaint(() => {
      ran = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ran).toBe(true);
  });

  it("cancels so the callback never runs", async () => {
    let ran = false;
    const cancel = scheduleAfterPaint(() => {
      ran = true;
    });
    cancel();

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ran).toBe(false);
  });

  it("runs exactly once even though the fallback races the frame path", async () => {
    let calls = 0;
    scheduleAfterPaint(() => {
      calls += 1;
    });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(calls).toBe(1);
  });

  it("stays idle without a window", () => {
    // Stub the global away so this genuinely exercises the SSR path instead
    // of relying on the happy-dom environment having a window.
    vi.stubGlobal("window", undefined);
    let ran = false;
    const cancel = scheduleAfterPaint(() => {
      ran = true;
    });
    expect(ran).toBe(false);
    cancel();
  });
});

describe("useAfterPaint", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function Probe() {
    const ready = useAfterPaint();
    return <output>{ready ? "ready" : "waiting"}</output>;
  }

  it("flips true after the paint window", async () => {
    act(() => {
      root.render(<Probe />);
    });
    expect(container.textContent).toBe("waiting");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(container.textContent).toBe("ready");
  });
});

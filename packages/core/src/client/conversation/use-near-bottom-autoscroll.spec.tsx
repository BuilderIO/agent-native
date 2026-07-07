// @vitest-environment happy-dom

import React, { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNearBottomAutoscroll } from "./use-near-bottom-autoscroll.js";

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(public callback: ResizeObserverCallback) {}
}

interface ScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

interface AutoscrollApi {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  isNearBottomRef: React.RefObject<boolean>;
  showScrollToBottom: boolean;
  markNearBottom: () => void;
  scrollToBottom: () => void;
  scrollToBottomAfterPaint: () => void;
}

function bottomScrollTop(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

function installScrollMetrics(element: HTMLDivElement, metrics: ScrollMetrics) {
  Object.defineProperties(element, {
    clientHeight: {
      configurable: true,
      get: () => metrics.clientHeight,
    },
    scrollHeight: {
      configurable: true,
      get: () => metrics.scrollHeight,
    },
    scrollTop: {
      configurable: true,
      get: () => metrics.scrollTop,
      set: (value: number) => {
        metrics.scrollTop = Math.max(
          0,
          Math.min(value, bottomScrollTop(metrics)),
        );
      },
    },
  });
}

function dispatchWheel(element: HTMLDivElement, deltaY: number) {
  const event = new Event("wheel", { bubbles: true }) as WheelEvent;
  Object.defineProperty(event, "deltaY", { value: deltaY });
  element.dispatchEvent(event);
}

function setUserScrollTop(element: HTMLDivElement, value: number) {
  element.scrollTop = value;
  element.dispatchEvent(new Event("scroll"));
}

// Simulates the message list briefly shrinking (content swap, collapsing
// placeholder, etc.). The browser is forced to clamp scrollTop down to the new
// bottom and fires a scroll event — without going through wheel/touch/keys.
function simulateContentShrink(
  element: HTMLDivElement,
  metrics: ScrollMetrics,
  scrollHeight: number,
) {
  metrics.scrollHeight = scrollHeight;
  metrics.scrollTop = Math.min(metrics.scrollTop, bottomScrollTop(metrics));
  element.dispatchEvent(new Event("scroll"));
}

function ScrollHarness({
  apiRef,
  followKey,
  metrics,
  streaming = false,
}: {
  apiRef: React.RefObject<AutoscrollApi | null>;
  followKey: unknown;
  metrics: ScrollMetrics;
  streaming?: boolean;
}) {
  const api = useNearBottomAutoscroll<HTMLDivElement>({
    followKey,
    streaming,
  });

  useLayoutEffect(() => {
    apiRef.current = api;
  });

  return (
    <>
      <div
        data-testid="scroller"
        ref={(element) => {
          api.scrollRef.current = element;
          if (element) installScrollMetrics(element, metrics);
        }}
      />
      <output data-testid="follow-state">
        {api.showScrollToBottom ? "detached" : "following"}
      </output>
    </>
  );
}

describe("useNearBottomAutoscroll", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      window.clearTimeout(id);
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderHarness({
    apiRef,
    followKey,
    metrics,
    streaming,
  }: {
    apiRef: React.RefObject<AutoscrollApi | null>;
    followKey: unknown;
    metrics: ScrollMetrics;
    streaming?: boolean;
  }) {
    act(() => {
      root.render(
        <ScrollHarness
          apiRef={apiRef}
          followKey={followKey}
          metrics={metrics}
          streaming={streaming}
        />,
      );
    });
    return container.querySelector<HTMLDivElement>('[data-testid="scroller"]')!;
  }

  async function advanceAutoscrollTimers() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  }

  it("keeps following content while pinned to the bottom", async () => {
    const apiRef = React.createRef<AutoscrollApi>();
    const metrics = {
      clientHeight: 200,
      scrollHeight: 1000,
      scrollTop: 800,
    };

    renderHarness({ apiRef, followKey: 1, metrics, streaming: true });

    metrics.scrollHeight = 1120;
    renderHarness({ apiRef, followKey: 2, metrics, streaming: true });
    await advanceAutoscrollTimers();

    expect(metrics.scrollTop).toBe(920);
    expect(
      container.querySelector('[data-testid="follow-state"]')?.textContent,
    ).toBe("following");
  });

  it("does not yank back down after upward user scroll intent", async () => {
    const apiRef = React.createRef<AutoscrollApi>();
    const metrics = {
      clientHeight: 200,
      scrollHeight: 1000,
      scrollTop: 800,
    };
    const scroller = renderHarness({
      apiRef,
      followKey: 1,
      metrics,
      streaming: true,
    });

    act(() => {
      dispatchWheel(scroller, -48);
      setUserScrollTop(scroller, 700);
    });
    expect(
      container.querySelector('[data-testid="follow-state"]')?.textContent,
    ).toBe("detached");

    metrics.scrollHeight = 1200;
    renderHarness({ apiRef, followKey: 2, metrics, streaming: true });
    await advanceAutoscrollTimers();

    expect(metrics.scrollTop).toBe(700);
  });

  it("keeps following when upward wheel intent belongs to a nested scroller", async () => {
    const apiRef = React.createRef<AutoscrollApi>();
    const metrics = {
      clientHeight: 200,
      scrollHeight: 1000,
      scrollTop: 800,
    };
    const nestedMetrics = {
      clientHeight: 100,
      scrollHeight: 300,
      scrollTop: 100,
    };
    const scroller = renderHarness({
      apiRef,
      followKey: 1,
      metrics,
      streaming: true,
    });
    const nested = document.createElement("div");
    nested.style.overflowY = "auto";
    installScrollMetrics(nested, nestedMetrics);
    scroller.appendChild(nested);

    act(() => {
      dispatchWheel(nested, -48);
    });
    expect(
      container.querySelector('[data-testid="follow-state"]')?.textContent,
    ).toBe("following");

    metrics.scrollHeight = 1200;
    renderHarness({ apiRef, followKey: 2, metrics, streaming: true });
    await advanceAutoscrollTimers();

    expect(metrics.scrollTop).toBe(1000);
    expect(
      container.querySelector('[data-testid="follow-state"]')?.textContent,
    ).toBe("following");
  });

  it("detaches on a small upward scroll near the bottom", async () => {
    const apiRef = React.createRef<AutoscrollApi>();
    const metrics = {
      clientHeight: 200,
      scrollHeight: 1000,
      scrollTop: 800,
    };
    const scroller = renderHarness({
      apiRef,
      followKey: 1,
      metrics,
      streaming: true,
    });

    act(() => {
      dispatchWheel(scroller, -8);
      setUserScrollTop(scroller, 790);
    });
    metrics.scrollHeight = 1040;
    renderHarness({ apiRef, followKey: 2, metrics, streaming: true });
    await advanceAutoscrollTimers();

    expect(metrics.scrollTop).toBe(790);
    expect(
      container.querySelector('[data-testid="follow-state"]')?.textContent,
    ).toBe("detached");
  });

  it("cancels delayed follow-up scrolls when the user scrolls away", async () => {
    const apiRef = React.createRef<AutoscrollApi>();
    const metrics = {
      clientHeight: 200,
      scrollHeight: 1000,
      scrollTop: 800,
    };
    const scroller = renderHarness({
      apiRef,
      followKey: 1,
      metrics,
      streaming: true,
    });

    act(() => {
      apiRef.current?.scrollToBottomAfterPaint();
      dispatchWheel(scroller, -32);
      setUserScrollTop(scroller, 660);
    });
    metrics.scrollHeight = 1160;
    await advanceAutoscrollTimers();

    expect(metrics.scrollTop).toBe(660);
    expect(
      container.querySelector('[data-testid="follow-state"]')?.textContent,
    ).toBe("detached");
  });

  it("stays anchored when content briefly collapses to the top", async () => {
    const apiRef = React.createRef<AutoscrollApi>();
    // A long, ongoing conversation pinned to the bottom.
    const metrics = {
      clientHeight: 200,
      scrollHeight: 3000,
      scrollTop: 2800,
    };
    const scroller = renderHarness({
      apiRef,
      followKey: 1,
      metrics,
      streaming: true,
    });

    // The list momentarily collapses (e.g. a re-render swaps the message
    // subtree on send). The browser clamps scrollTop to 0 and fires a scroll
    // event — this must NOT be mistaken for the user scrolling up.
    act(() => {
      simulateContentShrink(scroller, metrics, 200);
    });
    expect(metrics.scrollTop).toBe(0);
    expect(
      container.querySelector('[data-testid="follow-state"]')?.textContent,
    ).toBe("following");

    // Once the content comes back, we snap to the bottom instead of being
    // stranded at the top.
    metrics.scrollHeight = 3000;
    renderHarness({ apiRef, followKey: 2, metrics, streaming: true });
    await advanceAutoscrollTimers();

    expect(metrics.scrollTop).toBe(2800);
    expect(
      container.querySelector('[data-testid="follow-state"]')?.textContent,
    ).toBe("following");
  });

  it("reattaches once the user scrolls back to the bottom", async () => {
    const apiRef = React.createRef<AutoscrollApi>();
    const metrics = {
      clientHeight: 200,
      scrollHeight: 1000,
      scrollTop: 800,
    };
    const scroller = renderHarness({
      apiRef,
      followKey: 1,
      metrics,
      streaming: true,
    });

    act(() => {
      dispatchWheel(scroller, -64);
      setUserScrollTop(scroller, 620);
    });
    expect(
      container.querySelector('[data-testid="follow-state"]')?.textContent,
    ).toBe("detached");

    act(() => {
      setUserScrollTop(scroller, bottomScrollTop(metrics));
    });
    expect(
      container.querySelector('[data-testid="follow-state"]')?.textContent,
    ).toBe("following");

    metrics.scrollHeight = 1240;
    renderHarness({ apiRef, followKey: 2, metrics, streaming: true });
    await advanceAutoscrollTimers();

    expect(metrics.scrollTop).toBe(1040);
  });
});

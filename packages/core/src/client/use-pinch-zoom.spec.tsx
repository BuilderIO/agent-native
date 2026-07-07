// @vitest-environment happy-dom

/**
 * Regression coverage for the rAF-coalesced wheel/pinch path in
 * usePinchZoom: multiple wheel events landing in the same animation frame
 * must accumulate the same net zoom + cursor-anchored scroll compensation as
 * applying each event sequentially (the pre-coalescing, one-setZoom-per-event
 * behavior) — not just apply the last event's zoom while computing every
 * event's cursor anchor off the stale, pre-burst scroll position.
 */

import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePinchZoom } from "./use-pinch-zoom.js";

describe("usePinchZoom", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    rafCallbacks = [];
    // Controllable RAF: capture callbacks instead of running them immediately,
    // so the test can dispatch multiple wheel events "within one frame"
    // before flushing.
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback): number => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function flushRaf() {
    const callbacks = rafCallbacks;
    rafCallbacks = [];
    for (const cb of callbacks) cb(0);
  }

  function dispatchWheel(
    target: HTMLElement,
    opts: { clientX: number; clientY: number; deltaY: number },
  ) {
    const event = new WheelEvent("wheel", {
      deltaY: opts.deltaY,
      bubbles: true,
      cancelable: true,
    });
    // happy-dom's WheelEvent constructor drops `ctrlKey`, `clientX`, and
    // `clientY` from its init dict, so set them explicitly. The hook only
    // zooms when ctrlKey/metaKey is held, and reads clientX/clientY for the
    // cursor-anchor math — without these the anchor computes to NaN.
    Object.defineProperties(event, {
      ctrlKey: { value: true, configurable: true },
      clientX: { value: opts.clientX, configurable: true },
      clientY: { value: opts.clientY, configurable: true },
    });
    target.dispatchEvent(event);
  }

  interface HarnessHandle {
    scrollEl: HTMLDivElement;
    zoom: number;
  }

  function Harness({
    zoom,
    setZoom,
    onRef,
  }: {
    zoom: number;
    setZoom: (n: number) => void;
    onRef: (el: HTMLDivElement) => void;
  }) {
    const ref = useRef<HTMLDivElement | null>(null);
    usePinchZoom({ containerRef: ref, zoom, setZoom });
    return (
      <div
        ref={(el) => {
          ref.current = el;
          if (el) onRef(el);
        }}
        style={{ width: "500px", height: "500px", overflow: "auto" }}
      />
    );
  }

  async function renderHarness(initialZoom: number) {
    let zoom = initialZoom;
    let scrollEl: HTMLDivElement | null = null;
    const setZoom = vi.fn((next: number) => {
      zoom = next;
    });

    await act(async () => {
      root.render(
        <Harness
          zoom={zoom}
          setZoom={setZoom}
          onRef={(el) => {
            scrollEl = el;
          }}
        />,
      );
    });

    if (!scrollEl) throw new Error("container ref not attached");
    // jsdom/happy-dom don't lay out real geometry; stub a stable bounding box
    // and scrollable dimensions so scrollLeft/scrollTop are meaningful.
    (scrollEl as HTMLDivElement).getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 500,
        bottom: 500,
        width: 500,
        height: 500,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      }) as DOMRect;

    return {
      scrollEl: scrollEl as HTMLDivElement,
      setZoom,
      getZoom: () => zoom,
    };
  }

  it("applies a single wheel event's zoom-to-cursor compensation (baseline, unchanged behavior)", async () => {
    const { scrollEl, setZoom } = await renderHarness(100);
    scrollEl.scrollLeft = 0;
    scrollEl.scrollTop = 0;

    dispatchWheel(scrollEl, { clientX: 100, clientY: 100, deltaY: -50 });
    flushRaf();

    expect(setZoom).toHaveBeenCalledTimes(1);
    const nextZoom = setZoom.mock.calls[0][0] as number;
    const factor = Math.exp(-Math.max(-50, Math.min(50, -50)) * 0.01);
    const expectedZoom = Math.max(25, Math.min(400, 100 * factor));
    expect(nextZoom).toBeCloseTo(expectedZoom, 10);

    const cx = 100 - 0 + 0;
    const cy = 100 - 0 + 0;
    const ratio = expectedZoom / 100;
    const expectedDx = cx * (ratio - 1);
    const expectedDy = cy * (ratio - 1);
    expect(scrollEl.scrollLeft).toBeCloseTo(expectedDx, 6);
    expect(scrollEl.scrollTop).toBeCloseTo(expectedDy, 6);
  });

  it("accumulates cursor-anchored scroll compensation across multiple wheel events coalesced into one frame", async () => {
    const { scrollEl, setZoom } = await renderHarness(100);
    scrollEl.scrollLeft = 0;
    scrollEl.scrollTop = 0;

    // Two wheel events at the same cursor position land before the frame
    // flushes (simulating a fast trackpad burst).
    dispatchWheel(scrollEl, { clientX: 200, clientY: 150, deltaY: -20 });
    dispatchWheel(scrollEl, { clientX: 200, clientY: 150, deltaY: -20 });

    // Nothing applied yet — still coalescing within the frame.
    expect(setZoom).not.toHaveBeenCalled();

    flushRaf();

    // Only one state update for the whole burst (last-wins zoom).
    expect(setZoom).toHaveBeenCalledTimes(1);

    // Compute the expected result of applying both events *sequentially*
    // (the pre-coalescing ground truth): each event re-anchors on the
    // scroll position the previous event would have produced.
    const clamp = (n: number) => Math.max(25, Math.min(400, n));
    const step = (z: number, s: { x: number; y: number }, deltaY: number) => {
      const factor = Math.exp(-Math.max(-50, Math.min(50, deltaY)) * 0.01);
      const nextZ = clamp(z * factor);
      const cx = 200 - 0 + s.x;
      const cy = 150 - 0 + s.y;
      const ratio = nextZ / z;
      const dx = cx * (ratio - 1);
      const dy = cy * (ratio - 1);
      return { z: nextZ, s: { x: s.x + dx, y: s.y + dy } };
    };
    let state = { z: 100, s: { x: 0, y: 0 } };
    state = step(state.z, state.s, -20);
    state = step(state.z, state.s, -20);

    const appliedZoom = setZoom.mock.calls[0][0] as number;
    expect(appliedZoom).toBeCloseTo(state.z, 6);
    expect(scrollEl.scrollLeft).toBeCloseTo(state.s.x, 6);
    expect(scrollEl.scrollTop).toBeCloseTo(state.s.y, 6);

    // Discriminator: the previous (buggy) code anchored every event in the
    // burst against the container's real, pre-burst scrollLeft (0 here)
    // instead of the running simulated scroll position, so the second event's
    // dx would have been computed from cx = 200 + 0 rather than 200 + dx1.
    // The corrected accumulation must differ from that buggy total.
    const factorStep = Math.exp(-Math.max(-50, Math.min(50, -20)) * 0.01);
    const z1 = clamp(100 * factorStep);
    const z2 = clamp(z1 * factorStep);
    const buggyDx1 = 200 * (z1 / 100 - 1);
    const buggyDx2 = 200 * (z2 / z1 - 1); // stale anchor: uses scroll=0 again
    const buggyTotalDx = buggyDx1 + buggyDx2;
    expect(scrollEl.scrollLeft).not.toBeCloseTo(buggyTotalDx, 3);
  });

  it("keeps zoom-to-cursor correct across a longer burst (3+ events in one frame)", async () => {
    const { scrollEl, setZoom } = await renderHarness(100);
    scrollEl.scrollLeft = 40;
    scrollEl.scrollTop = 10;

    dispatchWheel(scrollEl, { clientX: 50, clientY: 60, deltaY: -10 });
    dispatchWheel(scrollEl, { clientX: 55, clientY: 65, deltaY: 15 });
    dispatchWheel(scrollEl, { clientX: 50, clientY: 60, deltaY: -30 });
    flushRaf();

    const clamp = (n: number) => Math.max(25, Math.min(400, n));
    const step = (
      z: number,
      s: { x: number; y: number },
      clientX: number,
      clientY: number,
      deltaY: number,
    ) => {
      const factor = Math.exp(-Math.max(-50, Math.min(50, deltaY)) * 0.01);
      const nextZ = clamp(z * factor);
      if (nextZ === z) return { z, s };
      const cx = clientX - 0 + s.x;
      const cy = clientY - 0 + s.y;
      const ratio = nextZ / z;
      const dx = cx * (ratio - 1);
      const dy = cy * (ratio - 1);
      return { z: nextZ, s: { x: s.x + dx, y: s.y + dy } };
    };
    let state = { z: 100, s: { x: 40, y: 10 } };
    state = step(state.z, state.s, 50, 60, -10);
    state = step(state.z, state.s, 55, 65, 15);
    state = step(state.z, state.s, 50, 60, -30);

    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(setZoom.mock.calls[0][0] as number).toBeCloseTo(state.z, 6);
    expect(scrollEl.scrollLeft).toBeCloseTo(state.s.x, 6);
    expect(scrollEl.scrollTop).toBeCloseTo(state.s.y, 6);
  });
});

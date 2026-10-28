// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forwardReviewOverlayWheel } from "./canvas-interactions/review-overlay-interaction";
import { stubFaithfulWheelEvent } from "./canvas-interactions/test-wheel-event";
import {
  getBoardSurfaceStaticPreviewTransform,
  getBoardSurfaceStaticPreviewViewport,
} from "./multi-screen/overview-layout";
import { MAX_ZOOM_FACTOR_PER_FRAME } from "./multi-screen/zoom-gesture";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

type WheelTick = {
  deltaX?: number;
  deltaY: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  cancelable?: boolean;
};

function trustedWheel(tick: WheelTick) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: tick.cancelable ?? true,
    deltaX: tick.deltaX ?? 0,
    deltaY: tick.deltaY,
    deltaMode: 0,
    clientX: 400,
    clientY: 300,
  });
  Object.defineProperty(event, "ctrlKey", { value: tick.ctrlKey ?? false });
  Object.defineProperty(event, "metaKey", { value: tick.metaKey ?? false });
  Object.defineProperty(event, "clientX", { value: 400 });
  Object.defineProperty(event, "clientY", { value: 300 });
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

const WHEEL_STEP_PER_NOTCH = 1.1;
const BREAKPOINT_LABEL_GESTURE_VISIBILITY_CSS_VAR =
  "--an-breakpoint-label-gesture-visibility";

function notchFactor(deltaY: number) {
  return Math.pow(WHEEL_STEP_PER_NOTCH, Math.abs(deltaY) / 100);
}

function readView(container: HTMLElement) {
  const world = container.querySelector<HTMLElement>(
    "[data-multi-screen-canvas-world]",
  );
  if (!world) throw new Error("world layer not rendered");
  const match =
    /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(
      world.style.transform,
    );
  if (!match) throw new Error(`unparsable transform: ${world.style.transform}`);
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    scale: Number(match[3]),
  };
}

describe("MultiScreenCanvas wheel zoom and pan", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        right: 800,
        bottom: 600,
        left: 0,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    rectSpy.mockRestore();
    container.remove();
  });

  async function renderSurface() {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[]}
          zoom={100}
          creation={{ activeTool: "move" }}
          onPick={() => {}}
        />,
      );
    });
    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();
    return surface!;
  }

  async function postScreenWheel(
    iframe: HTMLIFrameElement,
    data: Record<string, unknown>,
  ) {
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "embedded-canvas-wheel",
            deltaX: 0,
            deltaMode: 0,
            metaKey: false,
            shiftKey: false,
            ...data,
          },
          source: iframe.contentWindow,
        }),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    return readView(container);
  }

  function addScreenFrame(surface: HTMLElement, at: { x: number; y: number }) {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    surface.append(iframe);
    Object.defineProperty(iframe, "clientWidth", { value: 400 });
    Object.defineProperty(iframe, "clientHeight", { value: 300 });
    const frameRect = vi.fn(() => ({
      x: at.x,
      y: at.y,
      left: at.x,
      top: at.y,
      right: at.x + 400,
      bottom: at.y + 300,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    }));
    iframe.getBoundingClientRect = frameRect;
    return { iframe, frameRect };
  }

  function frameWindowOf(iframe: HTMLIFrameElement) {
    if (!iframe.contentWindow) throw new Error("Expected the screen frame");
    return iframe.contentWindow;
  }

  async function applyTicks(surface: HTMLElement, ticks: WheelTick[]) {
    await act(async () => {
      for (const tick of ticks) surface.dispatchEvent(trustedWheel(tick));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    return readView(container);
  }

  it("moves one accelerated mouse notch by a configured step, not the per-frame ceiling", async () => {
    const surface = await renderSurface();
    const view = await applyTicks(surface, [{ deltaY: -66.7, ctrlKey: true }]);
    expect(view.scale).toBeCloseTo(notchFactor(66.7), 6);
  });

  it("keeps a large fractional delta well under the per-frame ceiling", async () => {
    const surface = await renderSurface();
    const view = await applyTicks(surface, [{ deltaY: -240.5, ctrlKey: true }]);
    expect(view.scale).toBeCloseTo(notchFactor(240.5), 6);
    expect(view.scale).toBeLessThan(MAX_ZOOM_FACTOR_PER_FRAME);
  });

  it("keeps a gesture on one curve after its deltas ramp past the pinch band", async () => {
    const surface = await renderSurface();
    const view = await applyTicks(surface, [
      { deltaY: -6.4, ctrlKey: true },
      { deltaY: -120.5, ctrlKey: true },
      { deltaY: -240.5, ctrlKey: true },
    ]);
    expect(view.scale).toBeCloseTo(
      Math.exp(6.4 * 0.0075) * notchFactor(120.5) * notchFactor(240.5),
      6,
    );
    expect(view.scale).toBeLessThan(MAX_ZOOM_FACTOR_PER_FRAME);
  });

  it("bounds responsive breakpoint labels with the live zoom scale", async () => {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "screen-a.html",
              content: "<!doctype html><html><body></body></html>",
              breakpointWidths: [390],
            },
          ]}
          zoom={100}
          creation={{ activeTool: "move" }}
          metadataById={{ "screen-a": { width: 1280, height: 640 } }}
          geometry={{
            geometryById: {
              "screen-a": { x: 0, y: 0, width: 1280, height: 640 },
            },
          }}
          onPick={() => {}}
        />,
      );
    });

    const label = container.querySelector<HTMLElement>(
      "[data-breakpoint-frame] [data-frame-label]",
    );
    const world = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    );
    const surface = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-surface]",
    );
    expect(label).not.toBeNull();
    expect(world).not.toBeNull();
    expect(surface).not.toBeNull();
    const width = label!.style.getPropertyValue(
      "--an-breakpoint-label-max-width",
    );
    expect(width).toContain("100% / var(--an-chrome-scale");

    const view = await applyTicks(surface!, [{ deltaY: 100, ctrlKey: true }]);

    expect(view.scale).toBeLessThan(1);
    expect(
      world!.style.getPropertyValue(
        BREAKPOINT_LABEL_GESTURE_VISIBILITY_CSS_VAR,
      ),
    ).toBe("hidden");
    expect(
      Number(label!.style.getPropertyValue("--an-chrome-scale")),
    ).toBeCloseTo(1 / view.scale, 6);
    expect(
      label!.style.getPropertyValue("--an-breakpoint-label-max-width"),
    ).toBe(width);

    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    });

    expect(
      world!.style.getPropertyValue(
        BREAKPOINT_LABEL_GESTURE_VISIBILITY_CSS_VAR,
      ),
    ).toBe("");
  });

  it("still runs a genuine trackpad pinch on the pinch curve", async () => {
    const surface = await renderSurface();
    const view = await applyTicks(surface, [
      { deltaY: -6, ctrlKey: true },
      { deltaY: -8, ctrlKey: true },
      { deltaY: -6, ctrlKey: true },
    ]);
    expect(view.scale).toBeCloseTo(Math.exp(20 * 0.0075), 6);
  });

  it("applies both the zoom and the pan when one frame catches each", async () => {
    const zoomOnly = await applyTicks(await renderSurface(), [
      { deltaY: -100, ctrlKey: true },
    ]);

    await act(async () => root.unmount());
    root = createRoot(container);
    const surface = await renderSurface();
    const both = await applyTicks(surface, [
      { deltaY: -100, ctrlKey: true },
      { deltaX: 40, deltaY: 25 },
    ]);

    expect(zoomOnly.scale).toBeCloseTo(notchFactor(100), 6);
    expect(both.scale).toBeCloseTo(zoomOnly.scale, 10);
    expect(both.x).toBeCloseTo(zoomOnly.x - 40, 10);
    expect(both.y).toBeCloseTo(zoomOnly.y - 25, 10);
  });

  it("keeps a fast swipe's full travel instead of clipping it below the bridge's bound", async () => {
    const surface = await renderSurface();
    const view = await applyTicks(surface, [{ deltaX: 0, deltaY: 240 }]);
    expect(view.y).toBeCloseTo(-240, 10);
  });

  it.each([false, true])(
    "preserves iframe paint surfaces during a wheel gesture (zoom=%s)",
    async (zoom) => {
      const surface = await renderSurface();
      const content = document.createElement("div");
      content.dataset.screenContent = "large-import";
      content.style.pointerEvents = "auto";
      const iframe = document.createElement("iframe");
      iframe.style.width = "1440px";
      iframe.style.height = "42728px";
      iframe.style.filter = "opacity(0.9)";
      content.append(iframe);
      surface.append(content);
      const before = readView(container);

      const during = await applyTicks(surface, [
        { deltaY: -100, ctrlKey: zoom },
      ]);

      if (zoom) expect(during.scale).toBeGreaterThan(before.scale);
      else expect(during.y).toBeGreaterThan(before.y);
      expect(content.style.pointerEvents).toBe("none");
      expect(iframe.style.filter).toBe("opacity(0.9)");

      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 140));
      });
      expect(content.style.pointerEvents).toBe("auto");
      expect(iframe.style.filter).toBe("opacity(0.9)");
    },
  );

  it.each([false, true])(
    "moves the board paint window before the gesture commits (zoom=%s)",
    async (zooming) => {
      const geometry = { x: -65536, y: -65536, width: 131072, height: 131072 };
      await act(async () =>
        root.render(
          <MultiScreenCanvas
            screens={[]}
            zoom={zooming ? 3 : 2}
            creation={{ activeTool: "move" }}
            onPick={() => {}}
            board={{
              boardFileId: "board",
              boardFrameGeometry: geometry,
              boardFileContent:
                '<html><body><div data-agent-native-node-id="shape" style="position:absolute;left:0;top:0;width:100px;height:100px"></div></body></html>',
            }}
          />,
        ),
      );
      const surface = container.querySelector<HTMLElement>(
        "[data-multi-screen-canvas-surface]",
      )!;
      const replica = container.querySelector<HTMLIFrameElement>(
        "[data-board-static-preview-iframe]",
      )!;
      expect(replica).not.toBeNull();
      const before = replica.style.transform;
      expect(
        container
          .querySelector("[data-multi-screen-canvas-world]")!
          .contains(replica),
      ).toBe(false);
      expect(replica.parentElement!.style.inset).toBe("0");
      const beforeView = readView(container);

      const during = await applyTicks(
        surface,
        zooming
          ? [{ deltaY: -100, ctrlKey: true }]
          : [{ deltaX: 160, deltaY: 240 }],
      );

      if (zooming) {
        expect(during.scale).toBeGreaterThan(beforeView.scale);
        expect(replica.style.backfaceVisibility).toBe("visible");
      } else {
        expect(during.y).toBeCloseTo(beforeView.y - 240);
      }
      expect(replica.style.transform).not.toBe(before);
      expect(replica.style.transform).toBe(
        getBoardSurfaceStaticPreviewTransform({
          logicalGeometry: geometry,
          viewport: getBoardSurfaceStaticPreviewViewport(geometry),
          pan: { x: during.x, y: during.y },
          zoom: during.scale * 100,
        }),
      );
    },
  );

  it("does not report a zoom change after a pan-only scroll", async () => {
    const onZoomChange = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[]}
          zoom={100}
          creation={{ activeTool: "move" }}
          onPick={() => {}}
          camera={{ onZoomChange }}
        />,
      );
    });
    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();
    await applyTicks(surface!, [{ deltaY: 80 }]);
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 140));
    });
    expect(onZoomChange).not.toHaveBeenCalled();

    await applyTicks(surface!, [{ deltaY: -100, ctrlKey: true }]);
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 140));
    });
    expect(onZoomChange).toHaveBeenCalledOnce();
    expect(onZoomChange).toHaveBeenCalledWith(notchFactor(100) * 100);
  });

  describe("a wheel the comment overlay hands over", () => {
    beforeEach(stubFaithfulWheelEvent);
    afterEach(() => vi.unstubAllGlobals());

    const settle = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    it("zooms the canvas for a pinch, where a constructed wheel is otherwise ignored", async () => {
      const surface = await renderSurface();
      const before = readView(container);
      await act(async () => {
        surface.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: -100,
            ctrlKey: true,
          }),
        );
        await settle();
      });
      expect(readView(container).scale).toBe(before.scale);

      const pinch = trustedWheel({ deltaY: -100, ctrlKey: true });
      await act(async () => {
        forwardReviewOverlayWheel(pinch, surface);
        await settle();
      });
      expect(pinch.defaultPrevented).toBe(true);
      expect(readView(container).scale).toBeCloseTo(
        before.scale * notchFactor(100),
        6,
      );
    });

    it("pans the canvas for a plain scroll", async () => {
      const surface = await renderSurface();
      const before = readView(container);
      const scroll = trustedWheel({ deltaX: 40, deltaY: 25 });
      await act(async () => {
        forwardReviewOverlayWheel(scroll, surface);
        await settle();
      });
      expect(scroll.defaultPrevented).toBe(true);
      const after = readView(container);
      expect(after.x).toBeCloseTo(before.x - 40, 10);
      expect(after.y).toBeCloseTo(before.y - 25, 10);
      expect(after.scale).toBe(before.scale);
    });
  });

  it("does not commit a pinch while a slow frame holds its next step", async () => {
    const onZoomChange = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[]}
          zoom={100}
          creation={{ activeTool: "move" }}
          onPick={() => {}}
          camera={{ onZoomChange }}
        />,
      );
    });
    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    if (!surface) throw new Error("Expected the canvas surface");
    await applyTicks(surface, [{ deltaY: -6, ctrlKey: true }]);

    const heldFrames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => heldFrames.push(callback));
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        heldFrames[id - 1] = () => {};
      });
    try {
      await act(async () => {
        surface.dispatchEvent(trustedWheel({ deltaY: -6, ctrlKey: true }));
        await new Promise<void>((resolve) => setTimeout(resolve, 160));
      });
      // The step's frame was requested first; the commit's came due after the
      // delay and runs while the step is still queued.
      const stepFrames = heldFrames.slice(0, 1);
      const laterFrames = heldFrames.slice(1);
      expect(stepFrames).toHaveLength(1);
      await act(async () => {
        laterFrames.forEach((callback) => callback(performance.now()));
      });
      expect(onZoomChange).not.toHaveBeenCalled();
      const world = container.querySelector<HTMLElement>(
        "[data-multi-screen-canvas-world]",
      );
      expect(world?.style.willChange).toBe("transform");

      requestFrame.mockRestore();
      await act(async () => {
        stepFrames.forEach((callback) => callback(performance.now()));
      });
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    });
    expect(onZoomChange).toHaveBeenCalledOnce();
    expect(onZoomChange).toHaveBeenCalledWith(readView(container).scale * 100);
  });

  it("keeps a pinch over a screen anchored while measuring the frame once", async () => {
    const surface = await renderSurface();
    const start = readView(container);
    const { iframe, frameRect } = addScreenFrame(surface, {
      x: start.x + 100,
      y: start.y + 50,
    });
    const cursor = { x: start.x + 150, y: start.y + 90 };
    const worldUnderCursor = (view: ReturnType<typeof readView>) => ({
      x: (cursor.x - view.x) / view.scale,
      y: (cursor.y - view.y) / view.scale,
    });

    const pinchStep = () =>
      postScreenWheel(iframe, {
        deltaY: -6,
        clientX: 50,
        clientY: 40,
        ctrlKey: true,
      });

    const first = await pinchStep();
    const second = await pinchStep();

    expect(second.scale).toBeGreaterThan(first.scale);
    expect(first.scale).toBeGreaterThan(start.scale);
    expect(worldUnderCursor(second).x).toBeCloseTo(
      worldUnderCursor(start).x,
      6,
    );
    expect(worldUnderCursor(second).y).toBeCloseTo(
      worldUnderCursor(start).y,
      6,
    );
    expect(frameRect).toHaveBeenCalledOnce();

    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 140));
    });
    await pinchStep();
    expect(frameRect).toHaveBeenCalledTimes(2);
  });

  it("measures a screen again after a render that may have moved it", async () => {
    const surface = await renderSurface();
    const { iframe, frameRect } = addScreenFrame(surface, { x: 100, y: 50 });
    const pinchStep = () =>
      postScreenWheel(iframe, {
        deltaY: -6,
        clientX: 50,
        clientY: 40,
        ctrlKey: true,
      });

    await pinchStep();
    expect(frameRect).toHaveBeenCalledOnce();
    // A nudge or a collaborator's edit re-renders the board mid-gesture.
    await renderSurface();
    await pinchStep();
    expect(frameRect).toHaveBeenCalledTimes(2);
  });

  it("answers a screen's wheel and keeps the full travel of folded steps", async () => {
    const surface = await renderSurface();
    const { iframe } = addScreenFrame(surface, { x: 100, y: 50 });
    const replies = vi.spyOn(frameWindowOf(iframe), "postMessage");
    const before = readView(container);

    await postScreenWheel(iframe, {
      deltaY: 600,
      clientX: 10,
      clientY: 10,
      ctrlKey: false,
      steps: 3,
      seq: 7,
    });

    expect(replies).toHaveBeenCalledWith(
      { type: "embedded-canvas-wheel-read", seq: 7 },
      "*",
    );
    expect(readView(container).y).toBeCloseTo(before.y - 600, 10);
  });

  it("caps a folded pinch per frame exactly as it caps the same wheels over blank canvas", async () => {
    const pinch = Array.from({ length: 20 }, () => ({
      deltaY: -6,
      ctrlKey: true,
    }));
    const blank = await applyTicks(await renderSurface(), pinch);

    await act(async () => root.unmount());
    root = createRoot(container);
    const surface = await renderSurface();
    const { iframe } = addScreenFrame(surface, { x: 100, y: 50 });
    const folded = await postScreenWheel(iframe, {
      deltaY: -120,
      clientX: 300,
      clientY: 250,
      ctrlKey: true,
      steps: 20,
    });

    // Twenty steps ask for about 2.46x. Over blank canvas the browser hands
    // them to one frame as twenty wheels, and that frame moves at most 1.6x;
    // a screen hands them over folded, and its frame moves the same.
    expect(blank.scale).toBeCloseTo(MAX_ZOOM_FACTOR_PER_FRAME, 6);
    expect(folded.scale).toBeCloseTo(blank.scale, 10);
  });

  it("ignores a screen's wheel whose numbers are not finite, and still answers it", async () => {
    const surface = await renderSurface();
    const { iframe } = addScreenFrame(surface, { x: 100, y: 50 });
    const replies = vi.spyOn(frameWindowOf(iframe), "postMessage");
    const before = readView(container);

    for (const bad of [
      { clientX: Infinity },
      { clientY: Number.NaN },
      { deltaY: -Infinity },
      { deltaX: "far" },
    ]) {
      const after = await postScreenWheel(iframe, {
        deltaY: -6,
        clientX: 50,
        clientY: 40,
        ctrlKey: true,
        ...bad,
      });
      expect(after, Object.keys(bad)[0]).toEqual(before);
    }
    expect(
      replies.mock.calls.filter(
        ([message]) =>
          (message as { type?: string }).type === "embedded-canvas-wheel-read",
      ),
    ).toHaveLength(4);
  });

  it("keeps the zoom anchor on the screen a wheel came from", async () => {
    const surface = await renderSurface();
    const start = readView(container);
    const { iframe } = addScreenFrame(surface, {
      x: start.x + 100,
      y: start.y + 50,
    });
    // The page is 400 by 300; a point posted far outside it anchors at the
    // page's nearest corner.
    const corner = { x: start.x + 100 + 400, y: start.y + 50 };
    const worldUnderCorner = (view: ReturnType<typeof readView>) => ({
      x: (corner.x - view.x) / view.scale,
      y: (corner.y - view.y) / view.scale,
    });

    const after = await postScreenWheel(iframe, {
      deltaY: -6,
      clientX: 5000,
      clientY: -900,
      ctrlKey: true,
    });

    expect(after.scale).toBeGreaterThan(start.scale);
    expect(worldUnderCorner(after).x).toBeCloseTo(worldUnderCorner(start).x, 6);
    expect(worldUnderCorner(after).y).toBeCloseTo(worldUnderCorner(start).y, 6);
  });

  it("does not cancel a non-cancelable wheel", async () => {
    const surface = await renderSurface();
    const event = trustedWheel({
      deltaY: -100,
      ctrlKey: true,
      cancelable: false,
    });
    const preventDefault = vi.spyOn(event, "preventDefault");
    await act(async () => {
      surface.dispatchEvent(event);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(readView(container).scale).toBeCloseTo(notchFactor(100), 6);
  });
});

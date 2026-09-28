// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
          activeTool="move"
          onPick={() => {}}
        />,
      );
    });
    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();
    return surface!;
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

  it("moves one accelerated mouse notch by a Figma-sized step, not the per-frame ceiling", async () => {
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
            activeTool="move"
            onPick={() => {}}
            boardFileId="board"
            boardFrameGeometry={geometry}
            boardFileContent={
              '<html><body><div data-agent-native-node-id="shape" style="position:absolute;left:0;top:0;width:100px;height:100px"></div></body></html>'
            }
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
          activeTool="move"
          onPick={() => {}}
          onZoomChange={onZoomChange}
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

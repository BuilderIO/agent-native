// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SURFACE_PADDING } from "./multi-screen/overview-layout";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const SURFACE_WIDTH = 800;
const SURFACE_HEIGHT = 600;

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

describe("MultiScreenCanvas auto-fit framing", () => {
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
        right: SURFACE_WIDTH,
        bottom: SURFACE_HEIGHT,
        left: 0,
        width: SURFACE_WIDTH,
        height: SURFACE_HEIGHT,
        toJSON: () => ({}),
      });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    rectSpy.mockRestore();
    container.remove();
  });

  async function renderScreens(
    widths: number[],
    {
      height = 800,
      zoom = 100,
      chromeInsetLeft = 0,
      chromeInsetRight = 0,
    }: {
      height?: number;
      zoom?: number;
      chromeInsetLeft?: number;
      chromeInsetRight?: number;
    } = {},
  ) {
    const screens = widths.map((width, index) => ({
      id: `screen-${index}`,
      filename: `screen-${index}.html`,
      content: "<!doctype html><html><body></body></html>",
      width,
      height,
    }));
    const geometryById = Object.fromEntries(
      widths.map((width, index) => [
        `screen-${index}`,
        { x: index * (width + 120), y: 0, width, height },
      ]),
    );
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={zoom}
          activeTool="move"
          geometryById={geometryById}
          onPick={() => {}}
          chromeInsetLeft={chromeInsetLeft}
          chromeInsetRight={chromeInsetRight}
        />,
      );
    });
    return readView(container);
  }

  it("centres an overflowing lineup instead of pinning it against one edge", async () => {
    const view = await renderScreens([4000, 4000]);
    const totalWidth = 4000 + 120 + 4000;
    const expectedVisualLeft = (SURFACE_WIDTH - totalWidth * view.scale) / 2;
    expect(expectedVisualLeft).toBeLessThan(0);
    expect(view.x).toBeCloseTo(
      expectedVisualLeft - SURFACE_PADDING * view.scale,
      6,
    );
  });

  it("never fits below the floor where the canvas paints nothing", async () => {
    const view = await renderScreens([16384, 16384], { height: 1304 });
    expect((800 - 180) / (16384 * 2 + 120)).toBeLessThan(0.1);
    expect(view.scale).toBeCloseTo(0.1, 6);
  });

  it("keeps the first frame clear of the left/right chrome insets", async () => {
    await renderScreens([200]);
    const chromeInsetLeft = 344;
    const chromeInsetRight = 60;
    const view = await renderScreens([200], {
      chromeInsetLeft,
      chromeInsetRight,
    });
    const frameScreenLeft = view.x + SURFACE_PADDING * view.scale;
    const frameScreenRight = frameScreenLeft + 200 * view.scale;
    expect(frameScreenLeft).toBeGreaterThanOrEqual(chromeInsetLeft);
    expect(frameScreenRight).toBeLessThanOrEqual(
      SURFACE_WIDTH - chromeInsetRight,
    );
  });

  it("fits the initial camera to board objects when the design has no screens", async () => {
    const boardObjectLeft = 4000;
    const boardObjectTop = 3000;
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[]}
          zoom={100}
          activeTool="move"
          geometryById={{}}
          onPick={() => {}}
          boardFileId="__board__"
          boardFileContent={`<!doctype html><html><body><div data-agent-native-node-id="board-rect" style="position:absolute;left:${boardObjectLeft}px;top:${boardObjectTop}px;width:200px;height:120px"></div></body></html>`}
          boardFrameGeometry={{
            x: -65536,
            y: -65536,
            width: 131072,
            height: 131072,
          }}
        />,
      );
    });
    const view = readView(container);
    const centreX =
      view.x + (SURFACE_PADDING + boardObjectLeft + 100) * view.scale;
    const centreY =
      view.y + (SURFACE_PADDING + boardObjectTop + 60) * view.scale;
    expect(centreX).toBeGreaterThanOrEqual(0);
    expect(centreX).toBeLessThanOrEqual(SURFACE_WIDTH);
    expect(centreY).toBeGreaterThanOrEqual(0);
    expect(centreY).toBeLessThanOrEqual(SURFACE_HEIGHT);
  });

  it("preserves a manually panned camera when a late tall screen arrives", async () => {
    const initial = await renderScreens([400], { height: 800, zoom: 60 });
    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 96,
      deltaMode: 0,
    });
    Object.defineProperty(wheel, "isTrusted", { value: true });
    await act(async () => {
      surface!.dispatchEvent(wheel);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    const afterPan = readView(container);
    expect(afterPan.y).not.toBeCloseTo(initial.y, 6);

    const afterLateScreen = await renderScreens([400, 400], {
      height: 3334,
      zoom: 60,
    });
    expect(afterLateScreen.scale).toBeCloseTo(afterPan.scale, 6);
    expect(afterLateScreen.x).toBeCloseTo(afterPan.x, 6);
    expect(afterLateScreen.y).toBeCloseTo(afterPan.y, 6);
  });
});

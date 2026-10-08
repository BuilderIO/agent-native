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

// The widget pane sizes ChatGPT and Codex hand the app, narrow and wide.
const NARROW_PANE = { width: 620, height: 860 };
const WIDE_PANE = { width: 1100, height: 900 };

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
  let pane = { width: SURFACE_WIDTH, height: SURFACE_HEIGHT };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    pane = { width: SURFACE_WIDTH, height: SURFACE_HEIGHT };
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({
        x: 0,
        y: 0,
        top: 0,
        right: pane.width,
        bottom: pane.height,
        left: 0,
        width: pane.width,
        height: pane.height,
        toJSON: () => ({}),
      }));
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
      initialFitScreenId,
      fillFocusedViewport,
      selectedScreenIds,
      paneSize,
    }: {
      height?: number;
      zoom?: number;
      chromeInsetLeft?: number;
      chromeInsetRight?: number;
      initialFitScreenId?: string | null;
      fillFocusedViewport?: boolean;
      selectedScreenIds?: string[];
      paneSize?: { width: number; height: number };
    } = {},
  ) {
    if (paneSize) pane = paneSize;
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
          creation={{ activeTool: "move" }}
          geometry={{ geometryById }}
          onPick={() => {}}
          camera={{
            chromeInsetLeft,
            chromeInsetRight,
            initialFitScreenId,
            fillFocusedViewport,
          }}
          selection={{ selectedScreenIds }}
        />,
      );
    });
    return readView(container);
  }

  function frameScreenRect(
    view: ReturnType<typeof readView>,
    index: number,
    width: number,
    height: number,
  ) {
    const left =
      view.x + (SURFACE_PADDING + index * (width + 120)) * view.scale;
    const top = view.y + SURFACE_PADDING * view.scale;
    return {
      left,
      top,
      right: left + width * view.scale,
      height: height * view.scale,
    };
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
          creation={{ activeTool: "move" }}
          geometry={{ geometryById: {} }}
          onPick={() => {}}
          board={{
            boardFileId: "__board__",
            boardFileContent: `<!doctype html><html><body><div data-agent-native-node-id="board-rect" style="position:absolute;left:${boardObjectLeft}px;top:${boardObjectTop}px;width:200px;height:120px"></div></body></html>`,
            boardFrameGeometry: {
              x: -65536,
              y: -65536,
              width: 131072,
              height: 131072,
            },
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
  describe("initialFitScreenId", () => {
    it("fits every screen when it is omitted", async () => {
      const view = await renderScreens([1280, 1280, 1280], { height: 2560 });
      expect(view.scale).toBeLessThan(0.25);
    });

    it("fits the first screen edge to edge across the pane, flush with the top, when null", async () => {
      const view = await renderScreens([1280, 1280, 1280], {
        height: 2560,
        initialFitScreenId: null,
      });
      const frame = frameScreenRect(view, 0, 1280, 2560);
      expect(view.scale).toBeCloseTo(SURFACE_WIDTH / 1280, 6);
      expect(frame.left).toBeCloseTo(0, 4);
      expect(frame.right).toBeCloseTo(SURFACE_WIDTH, 4);
      expect(frame.top).toBeCloseTo(0, 4);
    });

    it.each([
      ["narrow", NARROW_PANE],
      ["wide", WIDE_PANE],
    ])(
      "fills a %s pane width with a 1440px desktop screen and starts at its top edge",
      async (_label, paneSize) => {
        const view = await renderScreens([1440, 1440], {
          height: 900,
          initialFitScreenId: null,
          paneSize,
        });
        const frame = frameScreenRect(view, 0, 1440, 900);
        expect(view.scale).toBeCloseTo(paneSize.width / 1440, 6);
        expect(frame.left).toBeCloseTo(0, 4);
        expect(frame.right).toBeCloseTo(paneSize.width, 4);
        expect(frame.top).toBeCloseTo(0, 4);
        // Not centered: a screen shorter than the pane leaves the space below
        // it, never a band above it.
        expect(frame.top + frame.height).toBeLessThan(paneSize.height);
      },
    );

    it("starts a screen taller than the pane at the top edge and lets it run past the bottom", async () => {
      const view = await renderScreens([1440], {
        height: 4000,
        initialFitScreenId: null,
        paneSize: NARROW_PANE,
      });
      const frame = frameScreenRect(view, 0, 1440, 4000);
      expect(frame.top).toBeCloseTo(0, 4);
      expect(frame.top + frame.height).toBeGreaterThan(NARROW_PANE.height);
    });

    it("lands on the selected screen over the requested one", async () => {
      const view = await renderScreens([1280, 1280, 1280], {
        height: 2560,
        initialFitScreenId: "screen-1",
        selectedScreenIds: ["screen-2"],
      });
      const frame = frameScreenRect(view, 2, 1280, 2560);
      expect(frame.left).toBeCloseTo(0, 4);
      expect(frame.right).toBeCloseTo(SURFACE_WIDTH, 4);
    });

    it("lands on the requested screen when nothing is selected", async () => {
      const view = await renderScreens([1280, 1280, 1280], {
        height: 2560,
        initialFitScreenId: "screen-1",
      });
      expect(frameScreenRect(view, 1, 1280, 2560).left).toBeCloseTo(0, 4);
    });

    it("zooms a narrow screen in but stops at 100%, centered across and flush with the top", async () => {
      const view = await renderScreens([390], {
        height: 600,
        zoom: 50,
        initialFitScreenId: null,
      });
      const frame = frameScreenRect(view, 0, 390, 600);
      expect(view.scale).toBeCloseTo(1, 6);
      expect(frame.left).toBeCloseTo((SURFACE_WIDTH - 390) / 2, 4);
      expect(frame.top).toBeCloseTo(0, 4);
    });
  });

  describe("fillFocusedViewport", () => {
    // Height the frame's card renders at, in canvas pixels.
    function renderedFrameHeight(index: number) {
      const card = container.querySelector<HTMLElement>(
        `[data-frame-id="screen-${index}"] [data-screen-card]`,
      );
      if (!card) throw new Error(`frame ${index} not rendered`);
      return Number.parseFloat(card.style.height);
    }

    it.each([
      ["narrow", NARROW_PANE],
      ["wide", WIDE_PANE],
    ])(
      "grows a short screen to the %s pane's viewport so no band is left below it",
      async (_label, paneSize) => {
        const view = await renderScreens([1440, 1440], {
          height: 900,
          initialFitScreenId: null,
          fillFocusedViewport: true,
          paneSize,
        });
        const frame = frameScreenRect(view, 0, 1440, renderedFrameHeight(0));
        expect(frame.top).toBeCloseTo(0, 4);
        expect(frame.top + frame.height).toBeGreaterThanOrEqual(
          paneSize.height - 1,
        );
        expect(frame.top + frame.height).toBeLessThan(paneSize.height + 2);
      },
    );

    it("leaves a screen taller than the pane at its own height so it still scrolls", async () => {
      await renderScreens([1440], {
        height: 4000,
        initialFitScreenId: null,
        fillFocusedViewport: true,
        paneSize: NARROW_PANE,
      });
      expect(renderedFrameHeight(0)).toBe(4000);
    });

    it("grows only the focused screen", async () => {
      await renderScreens([1440, 1440], {
        height: 900,
        initialFitScreenId: "screen-1",
        fillFocusedViewport: true,
        paneSize: NARROW_PANE,
      });
      expect(renderedFrameHeight(1)).toBeGreaterThan(900);
      expect(renderedFrameHeight(0)).toBe(900);
    });

    it("keeps frames at their own height unless the pane asks to be filled", async () => {
      await renderScreens([1440, 1440], {
        height: 900,
        initialFitScreenId: null,
        paneSize: NARROW_PANE,
      });
      expect(renderedFrameHeight(0)).toBe(900);
    });

    it("keeps every frame at its own height when the first layout fits all screens", async () => {
      await renderScreens([1440, 1440], {
        height: 900,
        fillFocusedViewport: true,
        paneSize: NARROW_PANE,
      });
      expect(renderedFrameHeight(0)).toBe(900);
      expect(renderedFrameHeight(1)).toBe(900);
    });
  });
});

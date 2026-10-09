// @vitest-environment happy-dom

import { act, useState } from "react";
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
    vi.unstubAllGlobals();
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
      fitFocusedViewport,
      selectedScreenIds,
      paneSize,
      breakpointWidths,
      breakpointHeights,
      onZoomChange,
      onScreenSelectionChange,
      preserveCameraOnScreenCountChange,
    }: {
      breakpointWidths?: number[];
      breakpointHeights?: Record<string, number>;
      onZoomChange?: (zoom: number) => void;
      onScreenSelectionChange?: (ids: string[]) => void;
      preserveCameraOnScreenCountChange?: boolean;
      height?: number;
      zoom?: number;
      chromeInsetLeft?: number;
      chromeInsetRight?: number;
      initialFitScreenId?: string | null;
      fillFocusedViewport?: boolean;
      fitFocusedViewport?: boolean;
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
      ...(breakpointWidths ? { breakpointWidths } : {}),
      ...(breakpointHeights ? { breakpointHeights } : {}),
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
            fitFocusedViewport,
            onZoomChange,
            preserveCameraOnScreenCountChange,
          }}
          selection={{ selectedScreenIds, onScreenSelectionChange }}
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

    it("lands on the requested route screen over a stale selection", async () => {
      const view = await renderScreens([1280, 1280, 1280], {
        height: 2560,
        initialFitScreenId: "screen-1",
        selectedScreenIds: ["screen-2"],
      });
      const frame = frameScreenRect(view, 1, 1280, 2560);
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

  describe("fitFocusedViewport", () => {
    it.each([
      ["narrow", NARROW_PANE],
      ["wide", WIDE_PANE],
    ])(
      "centers the focused tall screen and fits it fully in a %s pane",
      async (_label, paneSize) => {
        const view = await renderScreens([1440], {
          height: 2560,
          initialFitScreenId: "screen-0",
          fitFocusedViewport: true,
          paneSize,
        });
        const frame = frameScreenRect(view, 0, 1440, 2560);

        expect(frame.left).toBeCloseTo(
          (paneSize.width - 1440 * view.scale) / 2,
          4,
        );
        expect(frame.top).toBeGreaterThan(0);
        expect(frame.top).toBeCloseTo(
          (paneSize.height - 2560 * view.scale) / 2,
          4,
        );
        expect(frame.top + frame.height).toBeLessThanOrEqual(paneSize.height);
      },
    );

    it("fits a responsive screen together with its breakpoint frames, centered in the pane", async () => {
      const view = await renderScreens([1440], {
        height: 900,
        initialFitScreenId: "screen-0",
        fitFocusedViewport: true,
        paneSize: NARROW_PANE,
        breakpointWidths: [390],
      });
      const left = view.x + SURFACE_PADDING * view.scale;
      const groupRight = left + (1440 + 24 + 390) * view.scale;

      expect(left).toBeGreaterThanOrEqual(0);
      expect(groupRight).toBeLessThanOrEqual(NARROW_PANE.width);
      expect(left).toBeCloseTo(NARROW_PANE.width - groupRight, 0);
    });

    it("refits the focused screen when the widget pane is resized", async () => {
      const observers = new Map<Element, ResizeObserverCallback>();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(private readonly callback: ResizeObserverCallback) {}
          observe(target: Element) {
            observers.set(target, this.callback);
          }
          disconnect() {}
        },
      );

      const initial = await renderScreens([1440], {
        height: 2560,
        initialFitScreenId: "screen-0",
        fitFocusedViewport: true,
        paneSize: NARROW_PANE,
      });
      const surface = container.querySelector<HTMLElement>(
        "[data-multi-screen-canvas-surface]",
      );
      expect(surface).not.toBeNull();
      const callback = observers.get(surface!);
      expect(callback).toBeDefined();

      pane = WIDE_PANE;
      await act(async () => {
        callback!(
          [
            {
              target: surface!,
              contentRect: {
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                right: WIDE_PANE.width,
                bottom: WIDE_PANE.height,
                width: WIDE_PANE.width,
                height: WIDE_PANE.height,
                toJSON: () => ({}),
              },
              contentBoxSize: [
                {
                  inlineSize: WIDE_PANE.width,
                  blockSize: WIDE_PANE.height,
                },
              ],
            } as unknown as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
      });

      const resized = readView(container);
      expect(resized.scale).toBeGreaterThan(initial.scale);
      const frame = frameScreenRect(resized, 0, 1440, 2560);
      expect(frame.left).toBeGreaterThanOrEqual(0);
      expect(frame.right).toBeLessThanOrEqual(WIDE_PANE.width);
      expect(frame.top).toBeGreaterThanOrEqual(0);
      expect(frame.top + frame.height).toBeLessThanOrEqual(WIDE_PANE.height);
    });

    describe("widget open fit", () => {
      const PRIMARY_WIDTH = 1440;
      const BREAKPOINT_WIDTH = 390;
      const GROUP_WIDTH = PRIMARY_WIDTH + 24 + BREAKPOINT_WIDTH;
      let observers: Map<Element, ResizeObserverCallback>;
      let onZoomChange: ReturnType<typeof vi.fn>;
      let onScreenSelectionChange: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        pane = NARROW_PANE;
        observers = new Map();
        onZoomChange = vi.fn();
        onScreenSelectionChange = vi.fn();
        vi.stubGlobal(
          "ResizeObserver",
          class {
            constructor(private readonly callback: ResizeObserverCallback) {}
            observe(target: Element) {
              observers.set(target, this.callback);
            }
            disconnect() {}
          },
        );
      });

      // The editor echoes the canvas's reported zoom back as the zoom prop and
      // an explicit zoom turns on preserveCameraOnScreenCountChange.
      function Editor({
        breakpointHeights,
      }: {
        breakpointHeights: Record<string, number>;
      }) {
        const [zoom, setZoom] = useState(100);
        const [explicitZoom, setExplicitZoom] = useState(false);
        const screens = [
          {
            id: "screen-0",
            filename: "screen-0.html",
            content: "<!doctype html><html><body></body></html>",
            width: PRIMARY_WIDTH,
            height: 900,
            breakpointWidths: [BREAKPOINT_WIDTH],
            breakpointHeights,
          },
        ];
        return (
          <MultiScreenCanvas
            screens={screens}
            zoom={zoom}
            creation={{ activeTool: "move" }}
            geometry={{
              geometryById: {
                "screen-0": { x: 0, y: 0, width: PRIMARY_WIDTH, height: 900 },
              },
            }}
            onPick={() => {}}
            camera={{
              initialFitScreenId: "screen-0",
              fitFocusedViewport: true,
              preserveCameraOnScreenCountChange: explicitZoom,
              onZoomChange: (next) => {
                onZoomChange(next);
                setZoom(next);
                setExplicitZoom(true);
              },
            }}
            selection={{ onScreenSelectionChange }}
          />
        );
      }

      async function openWidget(options: {
        breakpointHeights: Record<string, number>;
        paneSize?: { width: number; height: number };
      }) {
        pane = options.paneSize ?? pane;
        await act(async () => {
          root.render(<Editor breakpointHeights={options.breakpointHeights} />);
        });
        return readView(container);
      }

      function expectGroupFitAndCentered(
        view: ReturnType<typeof readView>,
        groupHeight: number,
        paneSize = pane,
      ) {
        const left = view.x + SURFACE_PADDING * view.scale;
        const right = left + GROUP_WIDTH * view.scale;
        const top = view.y + SURFACE_PADDING * view.scale;
        const bottom = top + groupHeight * view.scale;
        expect(left).toBeGreaterThanOrEqual(-0.5);
        expect(right).toBeLessThanOrEqual(paneSize.width + 0.5);
        expect(top).toBeGreaterThanOrEqual(-0.5);
        expect(bottom).toBeLessThanOrEqual(paneSize.height + 0.5);
        expect(left).toBeCloseTo(paneSize.width - right, 0);
        expect(top).toBeCloseTo(paneSize.height - bottom, 0);
      }

      async function resizePane(next: { width: number; height: number }) {
        const surface = container.querySelector<HTMLElement>(
          "[data-multi-screen-canvas-surface]",
        );
        const callback = observers.get(surface!);
        expect(callback).toBeDefined();
        pane = next;
        await act(async () => {
          callback!(
            [
              {
                target: surface!,
                contentRect: {
                  x: 0,
                  y: 0,
                  top: 0,
                  left: 0,
                  right: next.width,
                  bottom: next.height,
                  width: next.width,
                  height: next.height,
                  toJSON: () => ({}),
                },
                contentBoxSize: [
                  { inlineSize: next.width, blockSize: next.height },
                ],
              } as unknown as ResizeObserverEntry,
            ],
            {} as ResizeObserver,
          );
        });
        return readView(container);
      }

      async function wheel(trusted: boolean) {
        const surface = container.querySelector<HTMLElement>(
          "[data-multi-screen-canvas-surface]",
        );
        const event = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 96,
          deltaMode: 0,
        });
        Object.defineProperty(event, "isTrusted", { value: trusted });
        await act(async () => {
          surface!.dispatchEvent(event);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        });
        return readView(container);
      }

      it("keeps the opened screen fit as the breakpoint frames are measured taller in several steps", async () => {
        for (const measured of [1181, 1900, 3200]) {
          const view = await openWidget({
            breakpointHeights: { [String(BREAKPOINT_WIDTH)]: measured },
          });
          expectGroupFitAndCentered(view, Math.max(900, measured));
        }
        for (const [selected] of onScreenSelectionChange.mock.calls) {
          expect(selected).toEqual([]);
        }
      });

      it("refits when the host pane is resized after the first fit was echoed as an explicit zoom", async () => {
        const open = await openWidget({
          breakpointHeights: { [String(BREAKPOINT_WIDTH)]: 2200 },
        });
        expectGroupFitAndCentered(open, 2200);

        const wide = await resizePane(WIDE_PANE);
        expectGroupFitAndCentered(wide, 2200);
        expect(wide.scale).toBeGreaterThan(open.scale);

        const back = await resizePane(NARROW_PANE);
        expectGroupFitAndCentered(back, 2200);
        expect(back.scale).toBeCloseTo(open.scale, 6);
        expect(back.x).toBeCloseTo(open.x, 4);
        expect(back.y).toBeCloseTo(open.y, 4);
      });

      it("stops following the content once the viewer wheels the canvas", async () => {
        await openWidget({
          breakpointHeights: { [String(BREAKPOINT_WIDTH)]: 1181 },
        });
        const wheeled = await wheel(true);

        const grown = await openWidget({
          breakpointHeights: { [String(BREAKPOINT_WIDTH)]: 3200 },
        });
        expect(grown.scale).toBeCloseTo(wheeled.scale, 6);
        expect(grown.x).toBeCloseTo(wheeled.x, 4);
        expect(grown.y).toBeCloseTo(wheeled.y, 4);

        const resized = await resizePane(WIDE_PANE);
        expect(resized.scale).toBeCloseTo(wheeled.scale, 6);
        expect(resized.x).toBeCloseTo(wheeled.x, 4);
        expect(resized.y).toBeCloseTo(wheeled.y, 4);
      });

      it("ignores a script-dispatched wheel, which is not the viewer", async () => {
        await openWidget({
          breakpointHeights: { [String(BREAKPOINT_WIDTH)]: 1181 },
        });
        await wheel(false);

        const grown = await openWidget({
          breakpointHeights: { [String(BREAKPOINT_WIDTH)]: 3200 },
        });
        expectGroupFitAndCentered(grown, 3200);
      });

      it("settles instead of re-reporting zoom while nothing changes", async () => {
        await openWidget({
          breakpointHeights: { [String(BREAKPOINT_WIDTH)]: 2200 },
        });
        const reported = onZoomChange.mock.calls.length;
        await openWidget({
          breakpointHeights: { [String(BREAKPOINT_WIDTH)]: 2200 },
        });
        await resizePane(NARROW_PANE);
        expect(onZoomChange.mock.calls.length).toBe(reported);
      });
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

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
      chromeInsetLeft = 0,
      chromeInsetRight = 0,
    }: {
      height?: number;
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
          zoom={100}
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
    // Math.max(24, ...) turned the negative centring term into a 24px pin, so
    // content wider than the surface hung off the opposite edge entirely.
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
    // A generated screen root can be 16384px wide; an honest fit of two of them
    // lands near 2% and the surface reads as empty.
    const view = await renderScreens([16384, 16384], { height: 1304 });
    expect((800 - 180) / (16384 * 2 + 120)).toBeLessThan(0.1);
    expect(view.scale).toBeCloseTo(0.1, 6);
  });

  it("keeps the first frame clear of the left/right chrome insets", async () => {
    // Without chromeInsetLeft/Right, centring against the raw surface width
    // renders the frame (and its label) underneath the left shell chrome —
    // real-world numbers: a 64px rail + 280px panel overlaps the first
    // screen at the default overview viewport (alt-drag-duplicate-2).
    const chromeInsetLeft = 344;
    const chromeInsetRight = 60;
    const view = await renderScreens([200], { chromeInsetLeft, chromeInsetRight });
    // The single screen sits at geometry.x = 0, so its on-screen left edge
    // is exactly the world pan's x plus the padded-world offset.
    const frameScreenLeft = view.x + SURFACE_PADDING * view.scale;
    const frameScreenRight = frameScreenLeft + 200 * view.scale;
    expect(frameScreenLeft).toBeGreaterThanOrEqual(chromeInsetLeft);
    expect(frameScreenRight).toBeLessThanOrEqual(SURFACE_WIDTH - chromeInsetRight);
  });
});

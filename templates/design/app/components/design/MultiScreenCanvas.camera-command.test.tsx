// @vitest-environment happy-dom

import { getCameraForBounds } from "@shared/canvas-math";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SURFACE_PADDING } from "./multi-screen/overview-layout";
import type { MultiScreenCanvasProps } from "./multi-screen/types";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const viewportRect = {
  x: 0,
  y: 0,
  top: 0,
  right: 800,
  bottom: 600,
  left: 0,
  width: 800,
  height: 600,
  toJSON: () => ({}),
};
const zeroRect = {
  ...viewportRect,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
};

describe("MultiScreenCanvas camera command delivery", () => {
  let container: HTMLDivElement;
  let root: Root;
  let measurable: boolean;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    measurable = false;
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => (measurable ? viewportRect : zeroRect));
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    rectSpy.mockRestore();
    container.remove();
  });

  const renderCanvas = async (
    cameraCommand: NonNullable<MultiScreenCanvasProps["cameraCommand"]>,
    options: {
      screens?: MultiScreenCanvasProps["screens"];
      selectedScreenIds?: string[];
      zoom?: number;
    } = {},
  ) => {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={options.screens ?? []}
          selectedScreenIds={options.selectedScreenIds}
          zoom={options.zoom ?? 100}
          onPick={() => {}}
          cameraCommand={cameraCommand}
        />,
      );
    });
  };

  const waitForAnimationFrame = async () => {
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  };

  it("keeps an unmeasurable command pending across overview readiness", async () => {
    const fitBounds = {
      left: 100,
      top: 200,
      right: 300,
      bottom: 300,
      width: 200,
      height: 100,
      centerX: 200,
      centerY: 250,
    };
    await renderCanvas({ fitBounds, nonce: 1 });
    const world = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    );
    expect(world?.style.transform).toBe("translate(0px, 0px) scale(1)");

    measurable = true;
    await waitForAnimationFrame();

    const expected = getCameraForBounds(
      fitBounds,
      { width: 800, height: 600 },
      {
        paddingScreenPx: 64,
        canvasPadding: SURFACE_PADDING,
      },
    );
    expect(world?.style.transform).toBe(
      `translate(${expected.x}px, ${expected.y}px) scale(${expected.zoom / 100})`,
    );
  });

  it("keeps the latest controlled zoom when a fit waits for a measurable surface", async () => {
    const fitBounds = {
      left: 100,
      top: 200,
      right: 300,
      bottom: 300,
      width: 200,
      height: 100,
      centerX: 200,
      centerY: 250,
    };
    const cameraCommand = { fitBounds, nonce: 1 };
    await renderCanvas(cameraCommand, { zoom: 240 });

    await renderCanvas(cameraCommand, { zoom: 320 });
    measurable = true;
    await waitForAnimationFrame();

    const world = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    );
    expect(world?.style.transform).toContain("scale(3.2)");

    await new Promise((resolve) => window.setTimeout(resolve, 140));
    expect(world?.style.transform).toContain("scale(3.2)");
  });

  it("does not apply a delayed fit after the user returns to the original zoom", async () => {
    const fitBounds = {
      left: 100,
      top: 200,
      right: 300,
      bottom: 300,
      width: 200,
      height: 100,
      centerX: 200,
      centerY: 250,
    };
    const cameraCommand = { fitBounds, nonce: 1 };
    await renderCanvas(cameraCommand, { zoom: 240 });

    await renderCanvas(cameraCommand, { zoom: 320 });
    await renderCanvas(cameraCommand, { zoom: 240 });
    measurable = true;
    await waitForAnimationFrame();

    const world = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    );
    expect(world?.style.transform).toContain("scale(2.4)");
  });

  it("writes the chrome counter-scale on the same imperative tick as the world transform", async () => {
    const fitBounds = {
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      centerX: 200,
      centerY: 150,
    };
    await renderCanvas({ fitBounds, nonce: 1 });
    measurable = true;
    await waitForAnimationFrame();

    const world = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    );
    const expected = getCameraForBounds(
      fitBounds,
      { width: 800, height: 600 },
      { paddingScreenPx: 64, canvasPadding: SURFACE_PADDING },
    );
    const worldScale = expected.zoom / 100;
    expect(world?.style.transform).toContain(`scale(${worldScale})`);
    expect(
      Number.parseFloat(world!.style.getPropertyValue("--an-chrome-scale")),
    ).toBeCloseTo(1 / worldScale, 10);
  });

  it("does not let a screen rerender restore the stale controlled zoom during a pending fit", async () => {
    const fitBounds = {
      left: 0,
      top: 0,
      right: 700,
      bottom: 500,
      width: 700,
      height: 500,
      centerX: 350,
      centerY: 250,
    };
    const cameraCommand = { fitBounds, nonce: 1 };
    const newScreen = {
      id: "new-screen.html",
      filename: "new-screen.html",
      content: "<body></body>",
    };
    await renderCanvas(cameraCommand, { zoom: 240 });
    measurable = true;
    await waitForAnimationFrame();

    const expected = getCameraForBounds(
      fitBounds,
      { width: 800, height: 600 },
      { paddingScreenPx: 64, canvasPadding: SURFACE_PADDING },
    );
    const world = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    );
    expect(world?.style.transform).toContain(`scale(${expected.zoom / 100})`);

    await renderCanvas(cameraCommand, {
      screens: [newScreen],
      selectedScreenIds: [newScreen.id],
      zoom: 240,
    });

    expect(world?.style.transform).toContain(`scale(${expected.zoom / 100})`);
  });

  it("applies a controlled zoom change before a pending fit commit", async () => {
    const fitBounds = {
      left: 0,
      top: 0,
      right: 700,
      bottom: 500,
      width: 700,
      height: 500,
      centerX: 350,
      centerY: 250,
    };
    const cameraCommand = { fitBounds, nonce: 1 };
    await renderCanvas(cameraCommand, { zoom: 240 });
    measurable = true;
    await waitForAnimationFrame();

    const world = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    );
    const expected = getCameraForBounds(
      fitBounds,
      { width: 800, height: 600 },
      { paddingScreenPx: 64, canvasPadding: SURFACE_PADDING },
    );
    expect(world?.style.transform).toContain(`scale(${expected.zoom / 100})`);

    await renderCanvas(cameraCommand, { zoom: 320 });
    expect(world?.style.transform).toContain("scale(3.2)");

    await new Promise((resolve) => window.setTimeout(resolve, 140));
    expect(world?.style.transform).toContain("scale(3.2)");
  });

  it("keeps frame chrome at screen scale when toolbar zoom follows a camera command", async () => {
    const command = {
      fitBounds: {
        left: 0,
        top: 0,
        right: 2000,
        bottom: 40000,
        width: 2000,
        height: 40000,
        centerX: 1000,
        centerY: 20000,
      },
      nonce: 1,
    };
    await renderCanvas(command);
    measurable = true;
    await waitForAnimationFrame();
    const world = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    )!;

    for (const zoom of [3.71, 25, 50, 100, 3.35]) {
      await renderCanvas(command, { zoom });
      expect(world.style.transform).toContain(`scale(${zoom / 100})`);
      expect(
        Number(world.style.getPropertyValue("--an-chrome-scale")),
      ).toBeCloseTo(100 / zoom, 10);
    }
  });

  it("keeps the overview surface clipped without taking ownership of preview scrolling", async () => {
    await renderCanvas({
      fitBounds: {
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        centerX: 50,
        centerY: 50,
      },
      nonce: 1,
    });
    const surface = container.firstElementChild as HTMLElement;
    expect(surface.className).toContain("overflow-clip");
    expect(surface.className).not.toContain("overflow-hidden");

    const offscreenFocusable = document.createElement("button");
    offscreenFocusable.tabIndex = 0;
    offscreenFocusable.style.position = "absolute";
    offscreenFocusable.style.top = "2000px";
    surface.append(offscreenFocusable);
    offscreenFocusable.focus();
    expect(surface.scrollTop).toBe(0);

    const previewScroller = document.createElement("div");
    previewScroller.style.overflow = "auto";
    Object.defineProperty(previewScroller, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    surface.append(previewScroller);
    previewScroller.scrollTop = 24;
    expect(previewScroller.scrollTop).toBe(24);
  });

  it("cancels a stale zero-size nonce when a newer command supersedes it", async () => {
    const staleBounds = {
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      centerX: 50,
      centerY: 50,
    };
    const currentBounds = {
      left: 500,
      top: -100,
      right: 900,
      bottom: 700,
      width: 400,
      height: 800,
      centerX: 700,
      centerY: 300,
    };
    await renderCanvas({ fitBounds: staleBounds, nonce: 1 });
    await renderCanvas({ fitBounds: currentBounds, nonce: 2 });

    measurable = true;
    await waitForAnimationFrame();

    const expected = getCameraForBounds(
      currentBounds,
      { width: 800, height: 600 },
      { paddingScreenPx: 64, canvasPadding: SURFACE_PADDING },
    );
    const world = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    );
    expect(world?.style.transform).toBe(
      `translate(${expected.x}px, ${expected.y}px) scale(${expected.zoom / 100})`,
    );
  });
});

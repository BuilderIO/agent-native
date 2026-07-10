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

vi.mock("@agent-native/core/client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/client")>();
  return {
    ...original,
    useT: () => (key: string) => key,
  };
});

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
  ) => {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[]}
          zoom={100}
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

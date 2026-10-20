// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MultiScreenCanvasTool } from "./multi-screen/types";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const SCREEN = {
  id: "screen-a",
  filename: "screen-a.html",
  content: "<!doctype html><html><body>Preview</body></html>",
};

function trustedWheel(init: { deltaY: number; ctrlKey?: boolean }) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: init.deltaY,
    deltaMode: 0,
  });
  Object.defineProperty(event, "ctrlKey", { value: init.ctrlKey ?? false });
  Object.defineProperty(event, "clientX", { value: 400 });
  Object.defineProperty(event, "clientY", { value: 300 });
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

async function nextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe("MultiScreenCanvas camera while a screen is focused in Interact", () => {
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

  async function render({
    interact,
    activeTool = "move",
    onGeometryCommit,
  }: {
    interact: boolean;
    activeTool?: MultiScreenCanvasTool;
    onGeometryCommit?: (...args: unknown[]) => void;
  }) {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[SCREEN]}
          zoom={100}
          creation={{ activeTool }}
          activeId="screen-a"
          selection={{ selectedScreenIds: ["screen-a"] }}
          interactScreenId={interact ? "screen-a" : null}
          focusedInteractViewport={
            interact ? { width: 390, height: 844 } : null
          }
          geometry={{
            geometryById: {
              "screen-a": { x: 0, y: 0, width: 390, height: 844 },
            },
            onGeometryCommit,
          }}
          onPick={() => {}}
        />,
      );
    });
    const surface = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-surface]",
    )!;
    const world = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    )!;
    expect(surface).not.toBeNull();
    expect(world).not.toBeNull();
    return { surface, world };
  }

  async function wheel(
    surface: HTMLElement,
    init: Parameters<typeof trustedWheel>[0],
  ) {
    const event = trustedWheel(init);
    await act(async () => {
      surface.dispatchEvent(event);
      await nextFrame();
    });
    return event;
  }

  it("leaves a wheel and a pinch uncancelled and the frame where it was", async () => {
    const { surface, world } = await render({ interact: true });
    const rest = world.style.transform;

    const scroll = await wheel(surface, { deltaY: 200 });
    const pinch = await wheel(surface, { deltaY: -120, ctrlKey: true });

    expect(scroll.defaultPrevented).toBe(false);
    expect(pinch.defaultPrevented).toBe(false);
    expect(world.style.transform).toBe(rest);
  });

  it("is the same camera that wheel-pans and wheel-zooms the board outside Interact", async () => {
    const { surface, world } = await render({ interact: false });
    const rest = world.style.transform;

    const scroll = await wheel(surface, { deltaY: 200 });
    expect(scroll.defaultPrevented).toBe(true);
    expect(world.style.transform).not.toBe(rest);

    const panned = world.style.transform;
    const pinch = await wheel(surface, { deltaY: -120, ctrlKey: true });
    expect(pinch.defaultPrevented).toBe(true);
    expect(world.style.transform).not.toBe(panned);
  });

  it("starts no pan from the middle button or the Hand tool", async () => {
    for (const { activeTool, button } of [
      { activeTool: "move", button: 1 },
      { activeTool: "hand", button: 0 },
    ] as const) {
      const { surface, world } = await render({ interact: true, activeTool });
      const rest = world.style.transform;
      const mouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button,
        clientX: 200,
        clientY: 200,
      });

      await act(async () => {
        surface.dispatchEvent(mouseDown);
        window.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: 260,
            clientY: 250,
          }),
        );
        await nextFrame();
      });

      expect(
        mouseDown.defaultPrevented,
        `${activeTool} / button ${button}`,
      ).toBe(false);
      expect(world.style.transform).toBe(rest);
      expect(surface.style.cursor).not.toBe("grabbing");
      await act(async () => {
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
    }
  });

  it("does not nudge the screen on an arrow key", async () => {
    const onGeometryCommit = vi.fn();
    await render({ interact: true, onGeometryCommit });
    const arrow = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      window.dispatchEvent(arrow);
    });

    expect(arrow.defaultPrevented).toBe(false);
    expect(onGeometryCommit).not.toHaveBeenCalled();
  });

  it("nudges a selected screen on an arrow key outside Interact", async () => {
    const onGeometryCommit = vi.fn();
    await render({ interact: false, onGeometryCommit });
    const arrow = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      window.dispatchEvent(arrow);
    });

    expect(arrow.defaultPrevented).toBe(true);
    expect(onGeometryCommit).toHaveBeenCalledTimes(1);
  });

  it("lets the browser scroll the page by touch", async () => {
    const { surface } = await render({ interact: true });
    const card = container.querySelector<HTMLElement>("[data-screen-card]")!;

    expect(surface.style.touchAction).not.toBe("none");
    expect(card.style.touchAction).not.toBe("none");
  });

  it("keeps the board's touch handling outside Interact", async () => {
    const { surface } = await render({ interact: false });
    const card = container.querySelector<HTMLElement>("[data-screen-card]")!;

    expect(surface.style.touchAction).toBe("none");
    expect(card.style.touchAction).toBe("none");
  });
});

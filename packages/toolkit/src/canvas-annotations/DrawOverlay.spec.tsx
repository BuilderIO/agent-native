// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DrawOverlay } from "./DrawOverlay.js";

vi.mock("../ui/tooltip.js", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("sonner", () => ({ toast: vi.fn() }));

const CANVAS_RECT = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 200,
  bottom: 100,
  width: 200,
  height: 100,
  toJSON: () => ({}),
} as DOMRect;

function pointerEvent(type: string, clientX: number, clientY: number) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse",
  });
}

describe("DrawOverlay clear undo", () => {
  let container: HTMLDivElement;
  let root: Root;
  let canvas: HTMLCanvasElement;
  const onSend = vi.fn();

  const render = async (scopeKey: string) => {
    await act(async () => {
      root.render(
        <DrawOverlay
          translate={(key) => key}
          visible
          scopeKey={scopeKey}
          onClose={vi.fn()}
          onSend={onSend}
        />,
      );
    });
  };

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => ({
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        lineTo: vi.fn(),
        moveTo: vi.fn(),
        scale: vi.fn(),
        stroke: vi.fn(),
      }),
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await render("screen-a");

    const renderedCanvas =
      container.querySelector<HTMLCanvasElement>("[data-draw-canvas]");
    if (!renderedCanvas) throw new Error("Draw canvas did not render");
    canvas = renderedCanvas;
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => CANVAS_RECT,
    });
    Object.defineProperties(canvas, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => false },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not restore a cleared batch after the canvas scope changes", async () => {
    await act(async () => {
      canvas.dispatchEvent(pointerEvent("pointerdown", 20, 20));
      canvas.dispatchEvent(pointerEvent("pointerup", 60, 40));
    });
    const clear = document.querySelector<HTMLButtonElement>(
      '[data-testid="draw-clear-all"]',
    );
    expect(clear?.disabled).toBe(false);
    await act(async () => {
      clear?.click();
    });

    const clearToastOptions = vi.mocked(toast).mock.calls.at(-1)?.[1] as
      | { action?: { onClick?: () => void } }
      | undefined;
    expect(clearToastOptions?.action?.onClick).toBeTypeOf("function");

    await render("screen-b");
    await act(async () => clearToastOptions?.action?.onClick?.());

    const send = document.querySelector<HTMLButtonElement>(
      '[data-testid="draw-send"]',
    );
    expect(send?.disabled).toBe(true);
    await act(async () => send?.click());
    expect(onSend).not.toHaveBeenCalled();
  });
});

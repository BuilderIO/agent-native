// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DrawOverlay, type DrawAnnotation } from "./DrawOverlay";

vi.mock("@agent-native/core/client", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
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

interface RenderedOverlay {
  canvas: HTMLCanvasElement;
  root: Root;
  container: HTMLDivElement;
  rerender: (visible: boolean) => Promise<void>;
  cleanup: () => Promise<void>;
}

function pointerEvent(
  type: string,
  clientX: number,
  clientY: number,
  pointerId = 1,
) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
    isPrimary: true,
    pointerId,
    pointerType: "mouse",
  });
}

async function renderOverlay(
  onSend: (
    annotations: DrawAnnotation[],
    instruction: string,
    canvasSize: { width: number; height: number },
  ) => void,
  queuedAnnotationCount = 0,
): Promise<RenderedOverlay> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const render = async (visible: boolean) => {
    await act(async () => {
      root.render(
        <DrawOverlay
          queuedAnnotationCount={queuedAnnotationCount}
          visible={visible}
          onClose={vi.fn()}
          onSend={onSend}
        />,
      );
    });
  };

  await render(true);
  const canvas =
    container.querySelector<HTMLCanvasElement>("[data-draw-canvas]");
  if (!canvas) throw new Error("Draw canvas did not render");

  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => CANVAS_RECT,
  });

  const capturedPointers = new Set<number>();
  Object.defineProperties(canvas, {
    setPointerCapture: {
      configurable: true,
      value: (pointerId: number) => capturedPointers.add(pointerId),
    },
    hasPointerCapture: {
      configurable: true,
      value: (pointerId: number) => capturedPointers.has(pointerId),
    },
    releasePointerCapture: {
      configurable: true,
      value: (pointerId: number) => capturedPointers.delete(pointerId),
    },
  });

  return {
    canvas,
    root,
    container,
    rerender: render,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

let cleanup: (() => Promise<void>) | undefined;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
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
});

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DrawOverlay pointer gesture robustness", () => {
  it("keeps an immediate pointerdown/move/up stroke before React can rerender", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend);
    cleanup = rendered.cleanup;

    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 20, 20));
      rendered.canvas.dispatchEvent(pointerEvent("pointermove", 40, 30));
      rendered.canvas.dispatchEvent(pointerEvent("pointerup", 60, 40));
    });

    const send = document.querySelector<HTMLButtonElement>(
      '[data-testid="draw-send"]',
    );
    expect(send?.disabled).toBe(false);
    await act(async () => send?.click());

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        type: "path",
        color: "#ef4444",
        lineWidth: 4,
        pathData: "M20.0,20.0 L40.0,30.0 L60.0,40.0",
      }),
    ]);
    expect(onSend.mock.calls[0][1]).toBe("");
    expect(onSend.mock.calls[0][2]).toEqual({ width: 200, height: 100 });
  });

  it("uses pointerup as the final sample when no move event was delivered", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend);
    cleanup = rendered.cleanup;

    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 10, 10));
      rendered.canvas.dispatchEvent(pointerEvent("pointerup", 90, 50));
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-send"]')
        ?.click();
    });

    expect(onSend.mock.calls[0][0][0].pathData).toBe("M10.0,10.0 L90.0,50.0");
  });

  it("discards a cancelled gesture without contaminating the next stroke", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend);
    cleanup = rendered.cleanup;

    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 10, 10));
      rendered.canvas.dispatchEvent(pointerEvent("pointermove", 20, 20));
      rendered.canvas.dispatchEvent(pointerEvent("pointercancel", 20, 20));
    });
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="draw-send"]')
        ?.disabled,
    ).toBe(true);

    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 100, 50, 2));
      rendered.canvas.dispatchEvent(pointerEvent("pointermove", 120, 60, 2));
      rendered.canvas.dispatchEvent(pointerEvent("pointerup", 140, 70, 2));
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-send"]')
        ?.click();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0][0].pathData).toBe(
      "M100.0,50.0 L120.0,60.0 L140.0,70.0",
    );
  });

  it("clears completed and active gestures when draw mode is hidden", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend);
    cleanup = rendered.cleanup;

    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 20, 20));
      rendered.canvas.dispatchEvent(pointerEvent("pointerup", 60, 40));
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-text-mode"]')
        ?.click();
    });
    await rendered.rerender(false);
    await rendered.rerender(true);

    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="draw-send"]')
        ?.disabled,
    ).toBe(true);
    expect(
      rendered.container.querySelector("[data-draw-canvas]")?.className,
    ).toContain("cursor-crosshair");
  });

  it("disables native touch panning on the drawing surface", async () => {
    const rendered = await renderOverlay(vi.fn());
    cleanup = rendered.cleanup;

    expect(rendered.canvas.classList.contains("touch-none")).toBe(true);
  });

  it("sends a still-focused pending text label without waiting for blur", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend);
    cleanup = rendered.cleanup;

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-text-mode"]')
        ?.click();
    });
    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 50, 25));
    });

    const input = rendered.container.querySelector<HTMLInputElement>(
      'input[placeholder="visualEditor.typeAnnotationFancy"]',
    );
    if (!input) throw new Error("Pending text input did not render");
    input.focus();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "Move this title");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.activeElement).toBe(input);

    const send = document.querySelector<HTMLButtonElement>(
      '[data-testid="draw-send"]',
    );
    expect(send?.disabled).toBe(false);
    await act(async () => send?.click());

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        type: "text",
        text: "Move this title",
        position: { x: 50, y: 25 },
      }),
    ]);
  });

  it("submits sibling comment pins when there is no local drawing", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend, 1);
    cleanup = rendered.cleanup;

    const send = document.querySelector<HTMLButtonElement>(
      '[data-testid="draw-send"]',
    );
    expect(send?.disabled).toBe(false);
    await act(async () => send?.click());

    expect(onSend).toHaveBeenCalledWith([], "", {
      width: 200,
      height: 100,
    });
  });
});

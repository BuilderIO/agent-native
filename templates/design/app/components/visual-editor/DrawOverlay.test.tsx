// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
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
  onClose: ReturnType<typeof vi.fn>;
  rerender: (
    visible: boolean,
    sending?: boolean,
    clearSignal?: number,
    scopeKey?: string,
  ) => Promise<void>;
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
  initialVisible = true,
  initialScopeKey?: string,
): Promise<RenderedOverlay> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClose = vi.fn();

  const render = async (
    visible: boolean,
    sending = false,
    clearSignal?: number,
    scopeKey?: string,
  ) => {
    await act(async () => {
      root.render(
        <DrawOverlay
          queuedAnnotationCount={queuedAnnotationCount}
          visible={visible}
          sending={sending}
          clearSignal={clearSignal}
          scopeKey={scopeKey}
          retainSurfaceWhenHidden
          onClose={onClose}
          onSend={onSend}
        />,
      );
    });
  };

  await render(initialVisible, false, undefined, initialScopeKey);
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
    onClose,
    rerender: render,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

let cleanup: (() => Promise<void>) | undefined;
let canvasContext: {
  beginPath: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
};
let resizeObserve: ReturnType<typeof vi.fn>;

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
  resizeObserve = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = resizeObserve;
      disconnect() {}
    },
  );

  canvasContext = {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    scale: vi.fn(),
    stroke: vi.fn(),
  };
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => canvasContext,
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

  it("preserves a completed stroke across a hide/show that has no clearSignal bump", async () => {
    // Regression test: `visible` toggling off must NOT discard already-
    // committed annotations. Only switching tools/views/panels (which flips
    // `drawMode` without the caller treating it as a deliberate discard)
    // should behave this way — the strokes survive so the user can re-enter
    // Annotate and still send what they drew. Text mode itself still resets
    // since that's transient tool-selection state, not committed content.
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
    ).toBe(false);
    expect(
      rendered.container.querySelector("[data-draw-canvas]")?.className,
    ).toContain("cursor-crosshair");

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-send"]')
        ?.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toEqual([
      expect.objectContaining({ type: "path" }),
    ]);
  });

  it("repaints preserved strokes before a hidden overlay becomes visible again", async () => {
    const rendered = await renderOverlay(vi.fn());
    cleanup = rendered.cleanup;

    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 20, 20));
      rendered.canvas.dispatchEvent(pointerEvent("pointerup", 60, 40));
    });
    const paintedBeforeHide = canvasContext.stroke.mock.calls.length;
    expect(paintedBeforeHide).toBeGreaterThan(0);

    await rendered.rerender(false);
    expect(rendered.container.querySelector("[data-draw-canvas]")).toBe(
      rendered.canvas,
    );
    await rendered.rerender(true);

    expect(canvasContext.stroke.mock.calls.length).toBeGreaterThan(
      paintedBeforeHide,
    );
  });

  it("installs canvas resize observation even when initially hidden", async () => {
    const rendered = await renderOverlay(vi.fn(), 0, false);
    cleanup = rendered.cleanup;

    expect(resizeObserve).toHaveBeenCalledWith(rendered.canvas);
    expect(rendered.container.querySelector("[data-draw-canvas]")).toBe(
      rendered.canvas,
    );
  });

  it("commits (rather than discards) a still-open pending text label on hide", async () => {
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
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "Still typing this");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Hide without ever clicking Send or blurring the input — e.g. the user
    // switched tools mid-label.
    await rendered.rerender(false);
    await rendered.rerender(true);

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-send"]')
        ?.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        type: "text",
        text: "Still typing this",
      }),
    ]);
  });

  it("clears strokes/text only when clearSignal is bumped (deliberate close or confirmed send)", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend);
    cleanup = rendered.cleanup;

    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 20, 20));
      rendered.canvas.dispatchEvent(pointerEvent("pointerup", 60, 40));
    });
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="draw-send"]')
        ?.disabled,
    ).toBe(false);

    // Same transition a real "X" close or confirmed-send exit performs: hide
    // AND bump clearSignal together.
    await rendered.rerender(false, false, 1);
    await rendered.rerender(true, false, 1);

    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="draw-send"]')
        ?.disabled,
    ).toBe(true);
  });

  it("clears and warns when a preserved batch changes screen scope", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend, 0, true, "screen-a");
    cleanup = rendered.cleanup;

    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 20, 20));
      rendered.canvas.dispatchEvent(pointerEvent("pointerup", 60, 40));
    });
    await rendered.rerender(false, false, undefined, "screen-b");
    await rendered.rerender(true, false, undefined, "screen-b");

    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="draw-send"]')
        ?.disabled,
    ).toBe(true);
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      "visualEditor.annotationsDiscardedOnViewChange",
    );
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

  it("commits a still-typed text label instead of discarding it when a new spot is clicked", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend);
    cleanup = rendered.cleanup;

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-text-mode"]')
        ?.click();
    });
    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 20, 20));
    });

    const firstInput = rendered.container.querySelector<HTMLInputElement>(
      'input[placeholder="visualEditor.typeAnnotationFancy"]',
    );
    if (!firstInput) throw new Error("First pending text input did not render");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(firstInput, "First label");
      firstInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Click a second spot before the first label's blur has a chance to run
    // (mirrors a real browser, where pointerdown on the canvas fires before
    // the outgoing input's native blur). Without committing the outgoing box
    // first, this used to silently discard "First label".
    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 120, 60));
    });

    const secondInput = rendered.container.querySelector<HTMLInputElement>(
      'input[placeholder="visualEditor.typeAnnotationFancy"]',
    );
    if (!secondInput)
      throw new Error("Second pending text input did not render");
    expect(secondInput.value).toBe("");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(secondInput, "Second label");
      secondInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const send = document.querySelector<HTMLButtonElement>(
      '[data-testid="draw-send"]',
    );
    await act(async () => send?.click());

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        type: "text",
        text: "First label",
        position: { x: 20, y: 20 },
      }),
      expect.objectContaining({
        type: "text",
        text: "Second label",
        position: { x: 120, y: 60 },
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

  it("disables Send and swaps its label while a capture is in flight", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend);
    cleanup = rendered.cleanup;

    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 20, 20));
      rendered.canvas.dispatchEvent(pointerEvent("pointermove", 40, 30));
      rendered.canvas.dispatchEvent(pointerEvent("pointerup", 60, 40));
    });
    const send = () =>
      document.querySelector<HTMLButtonElement>('[data-testid="draw-send"]');
    expect(send()?.disabled).toBe(false);
    expect(send()?.textContent).toContain("visualEditor.send");

    await rendered.rerender(true, true);

    expect(send()?.disabled).toBe(true);
    expect(send()?.textContent).toContain("visualEditor.sendingDrawing");

    await rendered.rerender(true, false);
    expect(send()?.disabled).toBe(false);
    expect(send()?.textContent).toContain("visualEditor.send");
  });

  it("ignores Enter while a submission is already in flight", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend, 1);
    cleanup = rendered.cleanup;
    await rendered.rerender(true, true);

    const instruction = document.querySelector<HTMLInputElement>(
      'input[placeholder="visualEditor.tellAgentWhatToDo"]',
    );
    expect(instruction).not.toBeNull();
    await act(async () => {
      instruction?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("freezes every annotation mutation while a submission is in flight", async () => {
    const onSend = vi.fn();
    const rendered = await renderOverlay(onSend);
    cleanup = rendered.cleanup;

    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 20, 20));
      rendered.canvas.dispatchEvent(pointerEvent("pointerup", 60, 40));
    });
    await rendered.rerender(true, true);

    await act(async () => {
      rendered.canvas.dispatchEvent(pointerEvent("pointerdown", 100, 50, 2));
      rendered.canvas.dispatchEvent(pointerEvent("pointerup", 140, 70, 2));
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-undo"]')
        ?.click();
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-clear-all"]')
        ?.click();
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-text-mode"]')
        ?.click();
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-exit"]')
        ?.click();
    });

    expect(rendered.onClose).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(rendered.canvas.className).toContain("pointer-events-none");

    await rendered.rerender(true, false);
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="draw-send"]')
        ?.click();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        type: "path",
        pathData: "M20.0,20.0 L60.0,40.0",
      }),
    ]);
  });
});

// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasCommentPins } from "./CanvasCommentPins";

vi.mock("@agent-native/core/client", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string =>
      options ? `${key}:${JSON.stringify(options)}` : key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div data-tooltip-content>{children}</div>
  ),
}));

const sendToDesignAgentChat = vi.fn((..._args: unknown[]) => "tab-1");
vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: (...args: unknown[]) => sendToDesignAgentChat(...args),
}));

const toastFn = vi.fn();
vi.mock("sonner", () => ({ toast: (...args: unknown[]) => toastFn(...args) }));

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

function clickAt(target: Element, clientX: number, clientY: number) {
  target.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    }),
  );
}

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

interface Rendered {
  container: HTMLDivElement;
  canvasEl: HTMLDivElement;
  root: Root;
  rerender: (props: Record<string, unknown>) => Promise<void>;
  cleanup: () => Promise<void>;
}

async function renderPins(
  props: Record<string, unknown> = {},
): Promise<Rendered> {
  // `canvasEl` stands in for the app's real slide/design canvas element,
  // which always lives outside the React tree CanvasCommentPins itself
  // renders into. It must be a *sibling* of `container`, not a child —
  // `createRoot(container).render(...)` takes ownership of `container` and
  // clears any DOM nodes placed inside it before the first commit, which
  // would silently delete a pre-existing child and make `canvasSelector`
  // resolve to nothing.
  const container = document.createElement("div");
  const canvasEl = document.createElement("div");
  canvasEl.setAttribute("data-test-canvas", "");
  document.body.append(canvasEl);
  document.body.append(container);

  Object.defineProperty(canvasEl, "getBoundingClientRect", {
    configurable: true,
    value: () => CANVAS_RECT,
  });

  const root = createRoot(container);
  const baseProps = {
    active: true,
    canvasSelector: "[data-test-canvas]",
    contextId: "slide-1",
    contextLabel: "Slide 1",
    onClose: vi.fn(),
    ...props,
  };

  const rerender = async (nextProps: Record<string, unknown>) => {
    await act(async () => {
      root.render(<CanvasCommentPins {...baseProps} {...nextProps} />);
    });
    // Let the canvas-lookup retry effect's setTimeout(50) settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  };

  await rerender({});

  return {
    container,
    canvasEl,
    root,
    rerender,
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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  toastFn.mockClear();
  sendToDesignAgentChat.mockClear();
});

describe("CanvasCommentPins anchoring and clustering", () => {
  it("spreads two pins dropped at nearly the same spot instead of stacking them", async () => {
    const rendered = await renderPins();
    cleanup = rendered.cleanup;

    await act(async () => {
      clickAt(rendered.canvasEl, 50, 50); // 25%, 50%
      clickAt(rendered.canvasEl, 52, 51); // 26%, 51% — within the overlap threshold
    });

    const pinEls = rendered.container.querySelectorAll("[data-pin-id]");
    expect(pinEls.length).toBe(2);

    const firstLeft = parseFloat((pinEls[0] as HTMLElement).style.left);
    const secondLeft = parseFloat((pinEls[1] as HTMLElement).style.left);
    const secondTop = parseFloat((pinEls[1] as HTMLElement).style.top);

    // The first pin renders at its exact percentage position; the second,
    // clustering with it, must be nudged so both stay individually visible
    // and clickable instead of rendering stacked on top of one another.
    expect(firstLeft).toBeCloseTo(50, 5);
    expect(secondLeft === 52 && secondTop === 51).toBe(false);
  });

  it("flags a pin whose anchored element has since been removed from the canvas", async () => {
    const rendered = await renderPins();
    cleanup = rendered.cleanup;

    const anchored = document.createElement("button");
    anchored.id = "hero-cta";
    anchored.textContent = "Get started";
    rendered.canvasEl.append(anchored);

    await act(async () => {
      anchored.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 20,
        }),
      );
    });

    const marker = () =>
      rendered.container.querySelector<HTMLButtonElement>(
        "[data-pin-id] button",
      );
    expect(marker()?.className).not.toContain("outline-dashed");

    // Simulate the element being deleted elsewhere on the canvas (e.g. the
    // agent or the user removed the layer), then force the component to
    // re-evaluate via the same window-resize listener it already relies on
    // to keep pins glued to the canvas — no dedicated poll needed.
    anchored.remove();
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(marker()?.className).toContain("outline-dashed");
    const tooltip = rendered.container.querySelector("[data-tooltip-content]");
    expect(tooltip?.textContent).toBe("visualEditor.staleAnchorDetail");
  });
});

describe("CanvasCommentPins queued draft handling", () => {
  it("warns instead of silently discarding a queued draft when the context changes", async () => {
    const rendered = await renderPins({ submitMode: "queue" });
    cleanup = rendered.cleanup;

    await act(async () => {
      clickAt(rendered.canvasEl, 20, 20);
    });

    const textarea = rendered.container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="visualEditor.tellAgentWhatToChange"]',
    );
    if (!textarea) throw new Error("Pin composer did not render");
    await act(async () => {
      setTextareaValue(textarea, "Make this button bigger");
    });

    const queueButton = Array.from(
      rendered.container.querySelectorAll("button"),
    ).find((btn) => btn.textContent?.includes("visualEditor.queue"));
    if (!queueButton) throw new Error("Queue button did not render");
    await act(async () => {
      queueButton.click();
    });

    // Switch to a different slide/design without submitting the queued draft.
    await rendered.rerender({ contextId: "slide-2" });

    expect(toastFn).toHaveBeenCalledTimes(1);
    expect(toastFn.mock.calls[0]?.[0]).toContain(
      "visualEditor.queuedCommentsDiscarded",
    );
  });

  it("does not warn when there is nothing queued", async () => {
    const rendered = await renderPins();
    cleanup = rendered.cleanup;

    await rendered.rerender({ contextId: "slide-2" });

    expect(toastFn).not.toHaveBeenCalled();
  });
});

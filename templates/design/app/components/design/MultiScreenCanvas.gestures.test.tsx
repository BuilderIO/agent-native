// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findCanvasIframeForScreen } from "./multi-screen/iframe-targeting";
import type { MultiScreenCanvasTool } from "./multi-screen/types";
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

function ToolHarness({ initialTool }: { initialTool: MultiScreenCanvasTool }) {
  const [tool, setTool] = useState(initialTool);
  return (
    <MultiScreenCanvas
      screens={[]}
      zoom={100}
      activeTool={tool}
      onActiveToolChange={setTool}
      onPick={() => {}}
    />
  );
}

function dispatchMouse(
  target: EventTarget,
  type: "mousedown" | "mousemove" | "mouseup",
  clientX: number,
  clientY: number,
) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === "mouseup" ? 0 : 1,
      clientX,
      clientY,
    }),
  );
}

async function nextAnimationFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe("MultiScreenCanvas gesture cancellation and drag thresholds", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
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

  async function renderHarness(initialTool: MultiScreenCanvasTool) {
    await act(async () => {
      root.render(<ToolHarness initialTool={initialTool} />);
    });
    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();
    return surface!;
  }

  async function createSelectedDraft(surface: HTMLElement) {
    await act(async () => {
      dispatchMouse(surface, "mousedown", 300, 300);
      dispatchMouse(window, "mouseup", 300, 300);
    });
    const draft = container.querySelector<HTMLElement>("[data-draft-id]");
    expect(draft).not.toBeNull();
    return draft!;
  }

  async function renderSelectedFrame() {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "screen-a.html",
              content: "<!doctype html><html><body></body></html>",
            },
          ]}
          zoom={100}
          activeTool="move"
          activeId="screen-a"
          selectedScreenIds={["screen-a"]}
          geometryById={{
            "screen-a": { x: 0, y: 0, width: 320, height: 640 },
          }}
          onPick={() => {}}
        />,
      );
    });
    const frame = container.querySelector<HTMLElement>(
      '[data-frame-id="screen-a"]',
    );
    const label = frame?.querySelector<HTMLElement>("[data-frame-label]");
    expect(frame).not.toBeNull();
    expect(label).not.toBeNull();
    return { frame: frame!, label: label! };
  }

  it("does not visually nudge a draft for pointer jitter below the drag threshold", async () => {
    const surface = await renderHarness("rect");
    const draft = await createSelectedDraft(surface);
    const before = { left: draft.style.left, top: draft.style.top };

    await act(async () => {
      dispatchMouse(draft, "mousedown", 320, 320);
      dispatchMouse(window, "mousemove", 321, 321);
      dispatchMouse(window, "mouseup", 321, 321);
    });

    expect(draft.style.left).toBe(before.left);
    expect(draft.style.top).toBe(before.top);
  });

  it("does not resize a draft for pointer jitter below the drag threshold", async () => {
    const surface = await renderHarness("rect");
    await createSelectedDraft(surface);
    const selectionBox = container.querySelector<HTMLElement>(
      "[data-frame-selection-box]",
    );
    const resizeHandle = selectionBox?.querySelector<HTMLElement>(
      '[data-resize-handle="se"]',
    );
    expect(selectionBox).not.toBeNull();
    expect(resizeHandle).not.toBeNull();
    const before = {
      width: selectionBox!.style.width,
      height: selectionBox!.style.height,
    };

    await act(async () => {
      dispatchMouse(resizeHandle!, "mousedown", 400, 400);
      dispatchMouse(window, "mousemove", 401, 401);
      dispatchMouse(window, "mouseup", 401, 401);
    });

    expect(selectionBox!.style.width).toBe(before.width);
    expect(selectionBox!.style.height).toBe(before.height);
  });

  it("restores direct-DOM draft movement when Escape cancels the drag", async () => {
    const surface = await renderHarness("rect");
    const draft = await createSelectedDraft(surface);
    const before = { left: draft.style.left, top: draft.style.top };

    await act(async () => {
      dispatchMouse(draft, "mousedown", 320, 320);
      dispatchMouse(window, "mousemove", 350, 345);
      await nextAnimationFrame();
    });
    expect(draft.style.left).not.toBe(before.left);
    expect(draft.style.top).not.toBe(before.top);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(draft.style.left).toBe(before.left);
    expect(draft.style.top).toBe(before.top);
  });

  it("restores direct-DOM frame movement when Escape cancels the drag", async () => {
    const { frame, label } = await renderSelectedFrame();
    const before = { left: frame.style.left, top: frame.style.top };

    await act(async () => {
      dispatchMouse(label, "mousedown", 320, 100);
      dispatchMouse(window, "mousemove", 355, 125);
      await nextAnimationFrame();
    });
    expect(frame.style.left).not.toBe(before.left);
    expect(frame.style.top).not.toBe(before.top);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(frame.style.left).toBe(before.left);
    expect(frame.style.top).toBe(before.top);
  });

  it("restores the camera origin when Escape cancels a mouse pan", async () => {
    const surface = await renderHarness("hand");
    const world = surface.querySelector<HTMLElement>(
      ":scope > .pointer-events-none.absolute",
    );
    expect(world).not.toBeNull();
    const originTransform = world!.style.transform;

    await act(async () => {
      dispatchMouse(surface, "mousedown", 200, 200);
      dispatchMouse(window, "mousemove", 260, 250);
      await nextAnimationFrame();
    });
    expect(world!.style.transform).not.toBe(originTransform);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(world!.style.transform).toBe(originTransform);
  });
});

describe("canvas iframe identity", () => {
  it("finds the board iframe through its wrapper even though it has no screen-id attribute", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-board-surface-layer>
        <iframe data-design-preview-iframe></iframe>
      </div>
      <iframe data-design-preview-iframe data-screen-iframe-id="screen-a"></iframe>
    `;

    const board = findCanvasIframeForScreen(root, "board", "board");
    const screen = findCanvasIframeForScreen(root, "screen-a", "board");

    expect(board).toBe(root.querySelector("[data-board-surface-layer] iframe"));
    expect(screen?.getAttribute("data-screen-iframe-id")).toBe("screen-a");
  });
});

describe("cold-open iframe culling", () => {
  it("does not render offscreen screen content before or after initial measurement", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const rectSpy = vi
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
    const renderScreenContent = vi.fn((screen: { id: string }) => (
      <div data-rendered-screen={screen.id} />
    ));
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <MultiScreenCanvas
            screens={[
              { id: "active", filename: "active.html", content: "" },
              { id: "far-away", filename: "far.html", content: "" },
            ]}
            activeId="active"
            zoom={100}
            geometryById={{
              active: { x: 0, y: 0, width: 320, height: 640 },
              "far-away": {
                x: 100_000,
                y: 100_000,
                width: 320,
                height: 640,
              },
            }}
            renderScreenContent={renderScreenContent}
            onPick={() => {}}
          />,
        );
      });

      expect(renderScreenContent).toHaveBeenCalledTimes(1);
      expect(renderScreenContent.mock.calls[0]?.[0].id).toBe("active");
      expect(
        container.querySelector('[data-rendered-screen="far-away"]'),
      ).toBeNull();
    } finally {
      await act(async () => root.unmount());
      rectSpy.mockRestore();
      container.remove();
    }
  });
});

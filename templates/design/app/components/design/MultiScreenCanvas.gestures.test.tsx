// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findCanvasIframeForScreen } from "./multi-screen/iframe-targeting";
import { SURFACE_PADDING } from "./multi-screen/overview-layout";
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

function dispatchMouseAlt(
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
      altKey: true,
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

  async function renderSelectedFrame(width = 320) {
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
            "screen-a": { x: 0, y: 0, width, height: 640 },
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

  it("keeps the Interact action inside narrow frames as a compact icon", async () => {
    const { frame } = await renderSelectedFrame(240);
    const fullView = frame.querySelector<HTMLElement>("[data-frame-full-view]");
    const fullViewLabel = fullView?.querySelector("span");

    expect(fullView).not.toBeNull();
    expect(fullView!.getAttribute("data-compact")).toBe("true");
    expect(fullView!.classList.contains("right-1")).toBe(true);
    expect(fullView!.classList.contains("w-5")).toBe(true);
    expect(fullView!.classList.contains("left-full")).toBe(false);
    expect(fullView!.style.maxWidth).toBe("20px");
    expect(fullViewLabel?.classList.contains("sr-only")).toBe(true);
    expect(fullView!.getAttribute("aria-label")).toBe(
      "designEditor.modes.interact",
    );
  });

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

  it("resizes a draft's DOM imperatively and restores it when Escape cancels the drag", async () => {
    const surface = await renderHarness("rect");
    const draft = await createSelectedDraft(surface);
    const selectionBox = container.querySelector<HTMLElement>(
      "[data-frame-selection-box]",
    );
    const resizeHandle = selectionBox?.querySelector<HTMLElement>(
      '[data-resize-handle="se"]',
    );
    expect(selectionBox).not.toBeNull();
    expect(resizeHandle).not.toBeNull();
    const before = {
      draftWidth: draft.style.width,
      draftHeight: draft.style.height,
      boxWidth: selectionBox!.style.width,
      boxHeight: selectionBox!.style.height,
    };

    // PERF9: beginDraftResize now writes the live geometry straight to the
    // draft's own DOM node + selection box via updateDraftPrimitivesRefOnly
    // (mirroring beginResize's frame path), instead of committing full React
    // state (setDraftPrimitives) on every native mousemove. Confirm those DOM
    // writes actually happen mid-gesture (not just at the eventual commit).
    await act(async () => {
      dispatchMouse(resizeHandle!, "mousedown", 400, 400);
      dispatchMouse(window, "mousemove", 450, 450);
      await nextAnimationFrame();
    });
    expect(draft.style.width).not.toBe(before.draftWidth);
    expect(draft.style.height).not.toBe(before.draftHeight);
    expect(selectionBox!.style.width).not.toBe(before.boxWidth);
    expect(selectionBox!.style.height).not.toBe(before.boxHeight);

    // Escape must roll back every DOM node the live resize mutated
    // imperatively, not just the (already-reverted) React draft state —
    // otherwise the shape stays visually stuck at its last dragged size.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(draft.style.width).toBe(before.draftWidth);
    expect(draft.style.height).toBe(before.draftHeight);
    expect(selectionBox!.style.width).toBe(before.boxWidth);
    expect(selectionBox!.style.height).toBe(before.boxHeight);
  });

  it("does not deselect an already-selected frame for shift-marquee jitter below the drag threshold", async () => {
    await renderSelectedFrame();
    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();
    expect(
      container.querySelector("[data-frame-selection-box]"),
    ).not.toBeNull();

    // MultiScreenCanvas auto-fits a lone screen into the mocked 800x600
    // surface on mount (see the "lineup fit" effect keyed on screens.length),
    // so pan/zoom aren't simply {0,0}/100 here. Read the actual world-layer
    // transform it committed instead of assuming a 1:1 mapping, so this test
    // targets the frame's real screen-space edge regardless of that fit math.
    const worldLayer = surface!.firstElementChild as HTMLElement;
    const transformMatch = worldLayer.style.transform.match(
      /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/,
    );
    expect(transformMatch).not.toBeNull();
    const [, panXStr, panYStr, scaleStr] = transformMatch!;
    const panX = Number.parseFloat(panXStr);
    const panY = Number.parseFloat(panYStr);
    const scale = Number.parseFloat(scaleStr);
    // Mirrors getCanvasPoint/screenToCanvasPoint's inverse: clientX = surface
    // rect.left (mocked to 0) + panX + (SURFACE_PADDING + canvasX) * scale.
    const clientPointForCanvas = (canvasX: number, canvasY: number) => ({
      clientX: panX + (SURFACE_PADDING + canvasX) * scale,
      clientY: panY + (SURFACE_PADDING + canvasY) * scale,
    });

    // The frame spans canvas x:[0,320]. Start a shift+mousedown just to the
    // right of it (on empty canvas, so beginMarquee fires, not the frame's
    // own drag), then jitter 2 canvas px left — comfortably below
    // DRAG_THRESHOLD (3 CLIENT px, and even smaller once scaled down here) —
    // which crosses back over the frame's right edge. Before the fix, every
    // mousemove (even sub-threshold ones) ran xorMarqueeSelection against the
    // live rect, so this exact jitter toggled the already-selected frame OUT
    // of the selection.
    const origin = clientPointForCanvas(321, 300);
    const jittered = clientPointForCanvas(319, 300);
    const dispatchShiftMouse = (
      target: EventTarget,
      type: "mousedown" | "mousemove" | "mouseup",
      clientX: number,
      clientY: number,
    ) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === "mouseup" ? 0 : 1,
          clientX,
          clientY,
          shiftKey: true,
        }),
      );

    await act(async () => {
      dispatchShiftMouse(surface!, "mousedown", origin.clientX, origin.clientY);
      dispatchShiftMouse(
        window,
        "mousemove",
        jittered.clientX,
        jittered.clientY,
      );
      dispatchShiftMouse(window, "mouseup", jittered.clientX, jittered.clientY);
    });

    expect(
      container.querySelector("[data-frame-selection-box]"),
    ).not.toBeNull();
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

  it("rotates a frame's DOM imperatively and restores it when Escape cancels the drag", async () => {
    const { frame } = await renderSelectedFrame();
    const selectionBox = container.querySelector<HTMLElement>(
      "[data-frame-selection-box]",
    );
    const rotateHandle = selectionBox?.querySelector<HTMLElement>(
      "[data-rotate-handle]",
    );
    expect(selectionBox).not.toBeNull();
    expect(rotateHandle).not.toBeNull();
    const before = {
      frameTransform: frame.style.transform,
      boxTransform: selectionBox!.style.transform,
    };

    // PERF9: rotate now writes the live transform straight to the frame
    // shell + selection box via updateFrameGeometryRefOnly (mirroring
    // beginFrameDrag), instead of committing full React state on every
    // native mousemove. A rotate gesture starts at the handle's own
    // position (outside the frame, near its corner) and needs to move past
    // the drag threshold from there.
    await act(async () => {
      dispatchMouse(rotateHandle!, "mousedown", 500, 100);
      dispatchMouse(window, "mousemove", 560, 100);
      await nextAnimationFrame();
    });
    expect(frame.style.transform).not.toBe(before.frameTransform);
    expect(selectionBox!.style.transform).not.toBe(before.boxTransform);

    // Escape must roll back the imperatively-mutated transform on both
    // nodes, not just the (already-reverted) React geometry state.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(frame.style.transform).toBe(before.frameTransform);
    expect(selectionBox!.style.transform).toBe(before.boxTransform);
  });

  it("resizes a frame's DOM imperatively and restores it when Escape cancels the drag", async () => {
    const { frame } = await renderSelectedFrame();
    const selectionBox = container.querySelector<HTMLElement>(
      "[data-frame-selection-box]",
    );
    const resizeHandle = selectionBox?.querySelector<HTMLElement>(
      '[data-resize-handle="se"]',
    );
    expect(selectionBox).not.toBeNull();
    expect(resizeHandle).not.toBeNull();
    const screenCard = frame.querySelector<HTMLElement>("[data-screen-card]");
    expect(screenCard).not.toBeNull();
    const before = {
      frameLeft: frame.style.left,
      frameWidth: frame.style.width,
      cardWidth: screenCard!.style.width,
      cardHeight: screenCard!.style.height,
      boxWidth: selectionBox!.style.width,
      boxHeight: selectionBox!.style.height,
    };

    // PERF9: resize now writes the live geometry straight to the frame
    // shell + screen-card + selection box via updateFrameGeometryRefOnly
    // (mirroring beginFrameDrag), instead of committing full React state on
    // every native mousemove. Confirm those DOM writes actually happen mid-
    // gesture (not just at the eventual React commit).
    await act(async () => {
      dispatchMouse(resizeHandle!, "mousedown", 400, 400);
      dispatchMouse(window, "mousemove", 450, 450);
      await nextAnimationFrame();
    });
    expect(frame.style.width).not.toBe(before.frameWidth);
    expect(screenCard!.style.width).not.toBe(before.cardWidth);
    expect(screenCard!.style.height).not.toBe(before.cardHeight);
    expect(selectionBox!.style.width).not.toBe(before.boxWidth);
    expect(selectionBox!.style.height).not.toBe(before.boxHeight);

    // Escape must roll back every DOM node the live resize mutated
    // imperatively, not just the (already-reverted) React geometry state —
    // otherwise the frame stays visually stuck at its last dragged size.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(frame.style.left).toBe(before.frameLeft);
    expect(frame.style.width).toBe(before.frameWidth);
    expect(screenCard!.style.width).toBe(before.cardWidth);
    expect(screenCard!.style.height).toBe(before.cardHeight);
    expect(selectionBox!.style.width).toBe(before.boxWidth);
    expect(selectionBox!.style.height).toBe(before.boxHeight);
  });

  it("moves the alt-drag duplicate ghost imperatively on every tick and unmounts it on release", async () => {
    const { label } = await renderSelectedFrame();

    // PERF9: beginDuplicateGesture now writes the ghost's left/top straight
    // to its own DOM node (data-duplicate-preview-ghost) every native
    // mousemove tick, instead of calling setDuplicatePreview (a full
    // re-render) unconditionally each time — see duplicatePreviewElRef.
    // canDuplicate/moved never flip in this harness (no onDuplicate prop is
    // passed), which is exactly the steady-state case the fix targets: the
    // ghost must still track the pointer on every tick even though nothing
    // conditional ever changes.
    await act(async () => {
      dispatchMouseAlt(label, "mousedown", 320, 100);
    });
    const ghost = container.querySelector<HTMLElement>(
      "[data-duplicate-preview-ghost]",
    );
    expect(ghost).not.toBeNull();
    const afterMount = { left: ghost!.style.left, top: ghost!.style.top };

    await act(async () => {
      dispatchMouseAlt(window, "mousemove", 400, 160);
      await nextAnimationFrame();
    });
    const afterFirstMove = { left: ghost!.style.left, top: ghost!.style.top };
    expect(afterFirstMove.left).not.toBe(afterMount.left);
    expect(afterFirstMove.top).not.toBe(afterMount.top);

    await act(async () => {
      dispatchMouseAlt(window, "mousemove", 430, 190);
      await nextAnimationFrame();
    });
    const afterSecondMove = { left: ghost!.style.left, top: ghost!.style.top };
    expect(afterSecondMove.left).not.toBe(afterFirstMove.left);
    expect(afterSecondMove.top).not.toBe(afterFirstMove.top);

    await act(async () => {
      dispatchMouseAlt(window, "mouseup", 430, 190);
    });
    expect(
      container.querySelector("[data-duplicate-preview-ghost]"),
    ).toBeNull();
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

  it("keeps locked screens visible but blocks canvas selection and dragging", async () => {
    const onPick = vi.fn();
    const onGeometryChange = vi.fn();
    const onGeometryCommit = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "locked-screen",
              filename: "locked.html",
              content: "<!doctype html><html><body></body></html>",
            },
          ]}
          zoom={100}
          selectedScreenIds={["locked-screen"]}
          lockedScreenIds={["locked-screen"]}
          geometryById={{
            "locked-screen": { x: 40, y: 50, width: 320, height: 640 },
          }}
          renderScreenContent={() => <div data-test-live-screen-content />}
          onPick={onPick}
          onGeometryChange={onGeometryChange}
          onGeometryCommit={onGeometryCommit}
        />,
      );
    });

    const frame = container.querySelector<HTMLElement>(
      '[data-frame-id="locked-screen"]',
    );
    const label = frame?.querySelector<HTMLElement>("[data-frame-label]");
    expect(frame).not.toBeNull();
    expect(label).not.toBeNull();
    expect(container.querySelector("[data-frame-selection-box]")).toBeNull();
    expect(
      frame?.querySelector<HTMLElement>("[data-screen-content]")?.style
        .pointerEvents,
    ).toBe("none");
    onGeometryChange.mockClear();
    onGeometryCommit.mockClear();

    await act(async () => {
      label!.click();
      dispatchMouse(label!, "mousedown", 300, 120);
      dispatchMouse(window, "mousemove", 380, 180);
      await nextAnimationFrame();
      dispatchMouse(window, "mouseup", 380, 180);
    });

    expect(onPick).not.toHaveBeenCalled();
    expect(onGeometryChange).not.toHaveBeenCalled();
    expect(onGeometryCommit).not.toHaveBeenCalled();
  });

  it("does not render hidden screens and restores their persisted geometry when shown", async () => {
    const screens = [
      {
        id: "visible-screen",
        filename: "visible.html",
        content: "<!doctype html><html><body></body></html>",
      },
      {
        id: "hidden-screen",
        filename: "hidden.html",
        content: "<!doctype html><html><body></body></html>",
      },
    ];
    const geometryById = {
      "visible-screen": { x: 0, y: 0, width: 320, height: 640 },
      "hidden-screen": { x: 480, y: 90, width: 360, height: 720 },
    };

    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={100}
          hiddenScreenIds={["hidden-screen"]}
          geometryById={geometryById}
          onPick={() => {}}
        />,
      );
    });
    expect(
      container.querySelector('[data-frame-id="visible-screen"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-frame-id="hidden-screen"]'),
    ).toBeNull();

    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={screens}
          zoom={100}
          hiddenScreenIds={[]}
          geometryById={geometryById}
          onPick={() => {}}
        />,
      );
    });
    const restored = container.querySelector<HTMLElement>(
      '[data-frame-id="hidden-screen"]',
    );
    expect(restored).not.toBeNull();
    expect(restored!.style.left).toContain("720px");
    expect(restored!.style.top).toContain("302px");
    expect(restored!.style.width).toBe("360px");
  });

  it("select-all excludes hidden and locked screens", async () => {
    const onScreenSelectionChange = vi.fn();
    const screens = ["visible", "locked", "hidden"].map((id) => ({
      id,
      filename: `${id}.html`,
      content: "<!doctype html><html><body></body></html>",
    }));
    const render = (selectAllRequest: number) => (
      <MultiScreenCanvas
        screens={screens}
        zoom={100}
        selectAllRequest={selectAllRequest}
        hiddenScreenIds={["hidden"]}
        lockedScreenIds={["locked"]}
        onPick={() => {}}
        onScreenSelectionChange={onScreenSelectionChange}
      />
    );

    await act(async () => root.render(render(0)));
    onScreenSelectionChange.mockClear();
    await act(async () => root.render(render(1)));

    expect(onScreenSelectionChange).toHaveBeenLastCalledWith(["visible"]);
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

  it("renders negative and positive board coordinates inside a bounded paint window", async () => {
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
    const root = createRoot(container);

    try {
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
            geometryById={{
              "screen-a": { x: 100, y: 80, width: 320, height: 640 },
            }}
            boardFileId="board"
            boardFileContent={`<!doctype html><html><body>
              <div data-agent-native-node-id="negative" data-an-primitive="rectangle" style="position:absolute;left:-165px;top:-90px;width:84px;height:76px"></div>
              <div data-agent-native-node-id="positive" data-an-primitive="rectangle" style="position:absolute;left:329px;top:210px;width:100px;height:60px"></div>
            </body></html>`}
            boardFrameGeometry={{
              x: -65536,
              y: -65536,
              width: 131072,
              height: 131072,
            }}
            boardEditMode
            onPick={() => {}}
          />,
        );
      });

      const boardLayer = container.querySelector<HTMLElement>(
        "[data-board-surface-layer]",
      );
      const iframe = boardLayer?.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(boardLayer).not.toBeNull();
      expect(iframe).not.toBeNull();
      expect(boardLayer!.style.left).toBe("-3856px");
      expect(boardLayer!.style.top).toBe("-3856px");
      expect(boardLayer!.style.width).toBe("8192px");
      expect(boardLayer!.style.height).toBe("8192px");
      expect(iframe!.srcdoc).toContain(
        "body > [data-agent-native-node-id]{translate:4096px 4096px;}",
      );
    } finally {
      await act(async () => root.unmount());
      rectSpy.mockRestore();
      container.remove();
    }
  });

  it("re-windows the board after a distant pan without replacing its iframe", async () => {
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
    const root = createRoot(container);

    try {
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
            activeTool="hand"
            geometryById={{
              "screen-a": { x: 100, y: 80, width: 320, height: 640 },
            }}
            boardFileId="board"
            boardFileContent={`<!doctype html><html><body>
              <div data-agent-native-node-id="negative" data-an-primitive="rectangle" style="position:absolute;left:-165px;top:-90px;width:84px;height:76px"></div>
            </body></html>`}
            boardFrameGeometry={{
              x: -65536,
              y: -65536,
              width: 131072,
              height: 131072,
            }}
            boardEditMode
            onPick={() => {}}
          />,
        );
      });

      const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
      const boardLayer = container.querySelector<HTMLElement>(
        "[data-board-surface-layer]",
      );
      const iframe = boardLayer?.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(surface).not.toBeNull();
      expect(boardLayer).not.toBeNull();
      expect(iframe).not.toBeNull();
      const initialLayerLeft = boardLayer!.style.left;
      const initialSrcdoc = iframe!.srcdoc;

      await act(async () => {
        dispatchMouse(surface!, "mousedown", 400, 300);
        dispatchMouse(window, "mousemove", -26_000, 300);
        await nextAnimationFrame();
        dispatchMouse(window, "mouseup", -26_000, 300);
        await nextAnimationFrame();
      });

      const rewindowedLayer = container.querySelector<HTMLElement>(
        "[data-board-surface-layer]",
      );
      const rewindowedIframe =
        rewindowedLayer?.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
      expect(rewindowedLayer!.style.left).not.toBe(initialLayerLeft);
      expect(rewindowedIframe).toBe(iframe);
      expect(rewindowedIframe!.srcdoc).toBe(initialSrcdoc);
    } finally {
      await act(async () => root.unmount());
      rectSpy.mockRestore();
      container.remove();
    }
  });

  it("keeps edge primitives visible and re-focuses the same live iframe when selected at 2% zoom", async () => {
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
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <MultiScreenCanvas
            screens={[]}
            zoom={2}
            activeTool="move"
            boardFileId="board"
            boardFileContent={`<!doctype html><html><body>
              <script>window.shouldNeverRunInStaticPreview = true</script>
              <div data-agent-native-node-id="left-edge" data-an-primitive="rectangle" style="position:absolute;left:100px;top:100px;width:100px;height:100px;background:#ef4444"></div>
              <div data-agent-native-node-id="right-edge" data-an-primitive="text" style="position:absolute;left:35000px;top:100px;color:#3b82f6">Edge label</div>
            </body></html>`}
            boardFrameGeometry={{
              x: -65536,
              y: -65536,
              width: 131072,
              height: 131072,
            }}
            boardEditMode
            onPick={() => {}}
          />,
        );
      });

      const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
      const staticPreview = container.querySelector<HTMLElement>(
        "[data-board-static-preview]",
      );
      const staticIframe = staticPreview?.querySelector<HTMLIFrameElement>(
        "iframe[data-board-static-preview-iframe]",
      );
      const activeLayer = container.querySelector<HTMLElement>(
        "[data-board-surface-layer]",
      );
      const activeIframe = activeLayer?.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(surface).not.toBeNull();
      expect(staticPreview).not.toBeNull();
      expect(staticIframe).not.toBeNull();
      expect(activeIframe).not.toBeNull();
      expect(staticIframe!.getAttribute("sandbox")).toBe("");
      expect(staticIframe!.getAttribute("sandbox")).not.toContain(
        "allow-scripts",
      );
      expect(staticIframe!.srcdoc).toContain("left-edge");
      expect(staticIframe!.srcdoc).toContain("right-edge");
      expect(staticIframe!.srcdoc).not.toContain("<script");

      const initialActiveIframe = activeIframe!;
      const initialActiveSrcdoc = initialActiveIframe.srcdoc;
      const initialActiveLeft = activeLayer!.style.left;
      const postMessage = vi.spyOn(
        initialActiveIframe.contentWindow!,
        "postMessage",
      );

      // pan=0 and zoom=2: screenX=(SURFACE_PADDING+boardX)*0.02.
      // right-edge is visible near the viewport's right edge but outside the
      // centered 24,576-world-pixel live iframe.
      await act(async () => {
        dispatchMouse(surface!, "mousedown", 706, 8);
        await nextAnimationFrame();
        await nextAnimationFrame();
      });

      const focusedLayer = container.querySelector<HTMLElement>(
        "[data-board-surface-layer]",
      );
      const focusedIframe = focusedLayer?.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(focusedLayer!.style.left).not.toBe(initialActiveLeft);
      expect(focusedIframe).toBe(initialActiveIframe);
      expect(focusedIframe!.srcdoc).toBe(initialActiveSrcdoc);
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: "select-element",
          selector: '[data-agent-native-node-id="right-edge"]',
          selectorCandidates: ['[data-agent-native-node-id="right-edge"]'],
        },
        "*",
      );
    } finally {
      await act(async () => root.unmount());
      rectSpy.mockRestore();
      container.remove();
    }
  });

  it("cancels a pending static-board handoff when the tool changes before the live post", async () => {
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
    const root = createRoot(container);
    const boardProps = {
      screens: [],
      zoom: 2,
      boardFileId: "board",
      boardFileContent: `<!doctype html><html><body>
        <div data-agent-native-node-id="left-edge" data-an-primitive="rectangle" style="position:absolute;left:100px;top:100px;width:100px;height:100px"></div>
        <div data-agent-native-node-id="right-edge" data-an-primitive="text" style="position:absolute;left:35000px;top:100px">Edge label</div>
      </body></html>`,
      boardFrameGeometry: {
        x: -65536,
        y: -65536,
        width: 131072,
        height: 131072,
      },
    };

    try {
      await act(async () => {
        root.render(
          <MultiScreenCanvas
            {...boardProps}
            activeTool="move"
            boardEditMode
            onPick={() => {}}
          />,
        );
      });
      const surface = container.querySelector<HTMLElement>('[tabindex="-1"]')!;
      const activeIframe = container.querySelector<HTMLIFrameElement>(
        "[data-board-surface-layer] iframe[data-design-preview-iframe]",
      )!;
      const postMessage = vi.spyOn(activeIframe.contentWindow!, "postMessage");

      await act(async () => {
        dispatchMouse(surface, "mousedown", 706, 8);
        // Invalidate the pending handoff before its live-bridge frame runs.
        root.render(
          <MultiScreenCanvas
            {...boardProps}
            activeTool="hand"
            boardEditMode
            onPick={() => {}}
          />,
        );
      });
      await act(async () => {
        await nextAnimationFrame();
        await nextAnimationFrame();
      });

      expect(postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "select-element" }),
        "*",
      );
    } finally {
      await act(async () => root.unmount());
      rectSpy.mockRestore();
      container.remove();
    }
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

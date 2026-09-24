// @vitest-environment happy-dom

import { act, type ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findCanvasIframeForScreen } from "./multi-screen/iframe-targeting";
import { SURFACE_PADDING } from "./multi-screen/overview-layout";
import type {
  DuplicateRequest,
  MultiScreenCanvasTool,
} from "./multi-screen/types";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

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
  type: "mousedown" | "mousemove" | "mouseup" | "click",
  clientX: number,
  clientY: number,
  modifiers: Pick<MouseEventInit, "shiftKey"> = {},
) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === "mouseup" ? 0 : 1,
      clientX,
      clientY,
      ...modifiers,
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

function dispatchMouseShift(
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
      shiftKey: true,
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

  async function renderSelectedFrame(
    width = 320,
    selected = true,
    onGeometryCommit = vi.fn(),
  ) {
    const onGeometryChange = vi.fn();
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
          selectedScreenIds={selected ? ["screen-a"] : []}
          geometryById={{
            "screen-a": { x: 0, y: 0, width, height: 640 },
          }}
          onPick={() => {}}
          onGeometryChange={onGeometryChange}
          onGeometryCommit={onGeometryCommit}
        />,
      );
    });
    const frame = container.querySelector<HTMLElement>(
      '[data-frame-id="screen-a"]',
    );
    const label = frame?.querySelector<HTMLElement>("[data-frame-label]");
    expect(frame).not.toBeNull();
    expect(label).not.toBeNull();
    return {
      frame: frame!,
      label: label!,
      onGeometryChange,
      onGeometryCommit,
    };
  }

  async function expectPortaledReviewTargetDoesNotStartGesture(
    target: ReactNode,
    selector: string,
  ) {
    const onLayerMarqueeSelectionChange = vi.fn();
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
          renderScreenContent={() => (
            <div className="design-canvas-iframe-wrapper">
              {createPortal(target, document.body)}
            </div>
          )}
          onPick={() => {}}
          onLayerMarqueeSelectionChange={onLayerMarqueeSelectionChange}
        />,
      );
    });
    const reviewTarget = document.querySelector<HTMLElement>(selector);
    expect(reviewTarget).not.toBeNull();

    await act(async () => {
      dispatchMouse(reviewTarget!, "mousedown", 160, 160);
      dispatchMouse(window, "mouseup", 160, 160);
    });

    expect(onLayerMarqueeSelectionChange).not.toHaveBeenCalled();
  }

  async function renderDelayedTwoScreenMarquee({
    selectedElementScreenId = null,
    selectedLayerSelectorGroupsByScreen,
    initialActiveTool = "move",
  }: {
    initialActiveTool?: MultiScreenCanvasTool;
    selectedElementScreenId?: string | null;
    selectedLayerSelectorGroupsByScreen?: Record<string, string[][]>;
  } = {}) {
    const onLayerMarqueeSelectionChange = vi.fn();
    const screens = [
      { id: "screen-a", filename: "screen-a.html", content: "" },
      { id: "screen-b", filename: "screen-b.html", content: "" },
    ];
    const renderCanvas = async (
      nextSelection: {
        activeTool?: MultiScreenCanvasTool;
        clearSelectionRequest?: number;
        selectedElementScreenId?: string | null;
        selectedLayerSelectorGroupsByScreen?: Record<string, string[][]>;
      } = {},
    ) => {
      await act(async () => {
        root.render(
          <MultiScreenCanvas
            screens={screens}
            zoom={100}
            activeTool={nextSelection.activeTool ?? initialActiveTool}
            clearSelectionRequest={nextSelection.clearSelectionRequest}
            selectedElementScreenId={nextSelection.selectedElementScreenId}
            selectedLayerSelectorGroupsByScreen={
              nextSelection.selectedLayerSelectorGroupsByScreen
            }
            geometryById={{
              "screen-a": { x: 0, y: 0, width: 320, height: 240 },
              "screen-b": { x: 400, y: 0, width: 320, height: 240 },
            }}
            metadataById={{
              "screen-a": { width: 1440, height: 900 },
              "screen-b": { width: 1440, height: 900 },
            }}
            renderScreenContent={(screen) => (
              <iframe data-screen-iframe-id={screen.id} />
            )}
            onPick={() => {}}
            onLayerMarqueeSelectionChange={onLayerMarqueeSelectionChange}
          />,
        );
      });
    };
    await renderCanvas({
      activeTool: initialActiveTool,
      selectedElementScreenId,
      selectedLayerSelectorGroupsByScreen,
    });

    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    const screenA = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="screen-a"]',
    );
    const screenB = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="screen-b"]',
    );
    const world = container.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    );
    expect(surface).not.toBeNull();
    expect(screenA?.contentWindow).not.toBeNull();
    expect(screenB?.contentWindow).not.toBeNull();
    expect(world).not.toBeNull();

    const transform = world!.style.transform.match(
      /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/,
    );
    expect(transform).not.toBeNull();
    const [, panX, panY, scale] = transform!;
    const clientPointForCanvas = (x: number, y: number) => ({
      clientX: Number(panX) + (SURFACE_PADDING + x) * Number(scale),
      clientY: Number(panY) + (SURFACE_PADDING + y) * Number(scale),
    });
    const candidate = (sourceId: string) => ({
      tagName: "article",
      sourceId,
      boundingRect: { x: 500, y: 100, width: 100, height: 100 },
    });
    const delayedReplies: Array<{
      correlationId: string;
      payload: unknown[];
    }> = [];
    const postMessageSpies = [screenA!, screenB!].map((iframe) =>
      vi
        .spyOn(iframe.contentWindow!, "postMessage")
        .mockImplementation((message: unknown) => {
          if (
            !message ||
            typeof message !== "object" ||
            (message as { type?: string }).type !==
              "agent-native:collect-selectable-rects"
          ) {
            return;
          }
          const data = message as {
            correlationId: string;
            includePortableStyleSnapshot?: boolean;
          };
          if (data.includePortableStyleSnapshot) {
            window.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  type: "agent-native:selectable-rects-result",
                  correlationId: data.correlationId,
                  payload: [
                    candidate(
                      iframe === screenA ? "screen-a-layer" : "screen-b-layer",
                    ),
                  ],
                },
                source: iframe.contentWindow,
              }),
            );
            return;
          }
          if (iframe === screenA) {
            window.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  type: "agent-native:selectable-rects-result",
                  correlationId: data.correlationId,
                  payload: [candidate("screen-a-layer")],
                },
                source: screenA!.contentWindow,
              }),
            );
          } else {
            delayedReplies.push({
              correlationId: data.correlationId,
              payload: [candidate("screen-b-layer")],
            });
          }
        }),
    );

    return {
      clientPointForCanvas,
      delayedReplies,
      onLayerMarqueeSelectionChange,
      postMessageSpies,
      renderCanvas,
      screenB: screenB!,
      surface: surface!,
    };
  }

  it("does not steal focus from review controls rendered over a screen", async () => {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "screen-a.html",
              content:
                "<!doctype html><html><body><button>Layer</button></body></html>",
            },
          ]}
          zoom={100}
          activeTool="comment"
          activeId="screen-a"
          selectedScreenIds={["screen-a"]}
          geometryById={{
            "screen-a": { x: 0, y: 0, width: 320, height: 640 },
          }}
          renderScreenContent={() => (
            <div className="design-canvas-iframe-wrapper">
              <div data-review-popover>
                <textarea aria-label="Edit prompt" />
              </div>
            </div>
          )}
          onPick={() => {}}
        />,
      );
    });
    const editPrompt = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Edit prompt"]',
    );
    expect(editPrompt).not.toBeNull();
    editPrompt!.focus();

    await act(async () => {
      dispatchMouse(editPrompt!, "mousedown", 160, 160);
    });

    expect(document.activeElement).toBe(editPrompt);
  });

  it("does not start a canvas gesture from the portaled review click plane", async () => {
    await expectPortaledReviewTargetDoesNotStartGesture(
      <div data-review-click-plane />,
      "[data-review-click-plane]",
    );
  });

  it("does not start a canvas gesture from a portaled review menu", async () => {
    await expectPortaledReviewTargetDoesNotStartGesture(
      <button type="button" data-review-popover />,
      "[data-review-popover]",
    );
  });

  it("routes an empty overview click to comment placement", async () => {
    const onCommentPin = vi.fn();
    const onLayerMarqueeSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[]}
          zoom={200}
          activeTool="comment"
          onCommentPin={onCommentPin}
          onLayerMarqueeSelectionChange={onLayerMarqueeSelectionChange}
          onPick={() => {}}
        />,
      );
    });
    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();

    await act(async () => {
      dispatchMouse(surface!, "mousedown", 160, 180);
      dispatchMouse(window, "mouseup", 160, 180);
    });

    expect(onCommentPin).toHaveBeenCalledWith({
      x: -160,
      y: -150,
    });
    expect(onLayerMarqueeSelectionChange).not.toHaveBeenCalled();
  });

  it("dedupes an unchanged empty layer marquee selection across ticks, then always sends one final report at mouseup", async () => {
    const onLayerMarqueeSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[]}
          zoom={100}
          activeTool="move"
          onPick={() => {}}
          onLayerMarqueeSelectionChange={onLayerMarqueeSelectionChange}
        />,
      );
    });
    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();

    await act(async () => {
      dispatchMouse(surface!, "mousedown", 100, 100);
      dispatchMouse(window, "mousemove", 140, 140);
      dispatchMouse(window, "mousemove", 180, 180);
      dispatchMouse(window, "mouseup", 180, 180);
    });

    // Figma parity: one drag = one selection-history entry. The two
    // unchanged in-drag ticks dedupe to a single report, but the host must
    // still be told the gesture actually ENDED (`final: true`) — otherwise
    // it can never record that one entry (coalesceMarqueeSelectionHistory) —
    // so mouseup always sends one more report even when nothing changed.
    expect(onLayerMarqueeSelectionChange).toHaveBeenCalledTimes(2);
    // Call 1 is the mousedown-time "clear whatever was selected" report;
    // every later in-drag tick reporting the same empty set dedupes away.
    expect(onLayerMarqueeSelectionChange).toHaveBeenNthCalledWith(
      1,
      [],
      expect.objectContaining({ source: "marquee" }),
    );
    // Call 2 is the mouseup-forced final report — required even though the
    // set never changed, or the gesture would never close out its history
    // entry (coalesceMarqueeSelectionHistory).
    expect(onLayerMarqueeSelectionChange).toHaveBeenNthCalledWith(
      2,
      [],
      expect.objectContaining({ source: "marquee", final: true }),
    );
  });

  it("waits for every intersected screen reply before finalizing a marquee", async () => {
    const {
      clientPointForCanvas,
      delayedReplies,
      onLayerMarqueeSelectionChange,
      postMessageSpies,
      screenB,
      surface,
    } = await renderDelayedTwoScreenMarquee();
    const origin = clientPointForCanvas(100, -20);
    const end = clientPointForCanvas(600, 100);

    try {
      await act(async () => {
        dispatchMouse(surface, "mousedown", origin.clientX, origin.clientY);
        dispatchMouse(window, "mousemove", end.clientX, end.clientY);
        await nextAnimationFrame();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(delayedReplies).toHaveLength(1);

      await act(async () => {
        dispatchMouse(window, "mouseup", end.clientX, end.clientY);
        await Promise.resolve();
      });

      expect(
        onLayerMarqueeSelectionChange.mock.calls.some(
          ([, intent]) => intent?.final === true,
        ),
      ).toBe(false);

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:selectable-rects-result",
              correlationId: delayedReplies[0]!.correlationId,
              payload: delayedReplies[0]!.payload,
            },
            source: screenB.contentWindow,
          }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const finalCalls = onLayerMarqueeSelectionChange.mock.calls.filter(
        ([, intent]) => intent?.final === true,
      );
      expect(finalCalls).toHaveLength(1);
      expect(
        finalCalls[0]?.[0].map(
          (item: { info: { sourceId?: string } }) => item.info.sourceId,
        ),
      ).toEqual(["screen-a-layer", "screen-b-layer"]);
    } finally {
      postMessageSpies.forEach((spy) => spy.mockRestore());
    }
  });

  it("retires a released marquee before a newer gesture can finalize", async () => {
    const {
      clientPointForCanvas,
      delayedReplies,
      onLayerMarqueeSelectionChange,
      postMessageSpies,
      screenB,
      surface,
    } = await renderDelayedTwoScreenMarquee();
    const origin = clientPointForCanvas(100, -20);
    const end = clientPointForCanvas(600, 100);
    const empty = clientPointForCanvas(-100, -100);

    try {
      await act(async () => {
        dispatchMouse(surface, "mousedown", origin.clientX, origin.clientY);
        dispatchMouse(window, "mousemove", end.clientX, end.clientY);
        await nextAnimationFrame();
        await Promise.resolve();
        await Promise.resolve();
        dispatchMouse(window, "mouseup", end.clientX, end.clientY);
        await Promise.resolve();
      });
      expect(delayedReplies).toHaveLength(1);
      expect(
        onLayerMarqueeSelectionChange.mock.calls.filter(
          ([, intent]) => intent?.final === true,
        ),
      ).toHaveLength(0);

      await act(async () => {
        dispatchMouse(surface, "mousedown", empty.clientX, empty.clientY);
        dispatchMouse(window, "mouseup", empty.clientX, empty.clientY);
        await Promise.resolve();
      });

      const newerGestureFinalCalls =
        onLayerMarqueeSelectionChange.mock.calls.filter(
          ([, intent]) => intent?.final === true,
        );
      expect(newerGestureFinalCalls).toHaveLength(1);
      expect(newerGestureFinalCalls[0]?.[0]).toEqual([]);

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:selectable-rects-result",
              correlationId: delayedReplies[0]!.correlationId,
              payload: delayedReplies[0]!.payload,
            },
            source: screenB.contentWindow,
          }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        onLayerMarqueeSelectionChange.mock.calls.filter(
          ([, intent]) => intent?.final === true,
        ),
      ).toHaveLength(1);
    } finally {
      postMessageSpies.forEach((spy) => spy.mockRestore());
    }
  });

  it("drops a released marquee when the host selection changes before its reply", async () => {
    const {
      clientPointForCanvas,
      delayedReplies,
      onLayerMarqueeSelectionChange,
      postMessageSpies,
      renderCanvas,
      screenB,
      surface,
    } = await renderDelayedTwoScreenMarquee();
    const origin = clientPointForCanvas(100, -20);
    const end = clientPointForCanvas(600, 100);

    try {
      await act(async () => {
        dispatchMouse(surface, "mousedown", origin.clientX, origin.clientY);
        dispatchMouse(window, "mousemove", end.clientX, end.clientY);
        await nextAnimationFrame();
        await Promise.resolve();
        await Promise.resolve();
        dispatchMouse(window, "mouseup", end.clientX, end.clientY);
        await Promise.resolve();
      });
      expect(delayedReplies).toHaveLength(1);

      await renderCanvas({ selectedElementScreenId: "screen-a" });

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:selectable-rects-result",
              correlationId: delayedReplies[0]!.correlationId,
              payload: delayedReplies[0]!.payload,
            },
            source: screenB.contentWindow,
          }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        onLayerMarqueeSelectionChange.mock.calls.filter(
          ([, intent]) => intent?.final === true,
        ),
      ).toHaveLength(0);
      expect(
        onLayerMarqueeSelectionChange.mock.calls.filter(
          ([, intent]) => intent?.cancelled === true,
        ),
      ).toHaveLength(1);
    } finally {
      postMessageSpies.forEach((spy) => spy.mockRestore());
    }
  });

  it("drops a released marquee when draft selection changes before its reply", async () => {
    const {
      clientPointForCanvas,
      delayedReplies,
      onLayerMarqueeSelectionChange,
      postMessageSpies,
      renderCanvas,
      screenB,
      surface,
    } = await renderDelayedTwoScreenMarquee({ initialActiveTool: "rect" });
    const origin = clientPointForCanvas(100, -20);
    const end = clientPointForCanvas(600, 100);

    await act(async () => {
      dispatchMouse(surface, "mousedown", 300, 300);
      dispatchMouse(window, "mouseup", 300, 300);
    });
    const draft = container.querySelector<HTMLElement>("[data-draft-id]");
    expect(draft).not.toBeNull();
    await renderCanvas({ activeTool: "move" });

    try {
      await act(async () => {
        dispatchMouse(surface, "mousedown", origin.clientX, origin.clientY, {
          shiftKey: true,
        });
        dispatchMouse(window, "mousemove", end.clientX, end.clientY, {
          shiftKey: true,
        });
        await nextAnimationFrame();
        await Promise.resolve();
        await Promise.resolve();
        dispatchMouse(window, "mouseup", end.clientX, end.clientY, {
          shiftKey: true,
        });
        await Promise.resolve();
      });
      expect(delayedReplies).toHaveLength(1);
      const cancellationsBeforeDraftChange =
        onLayerMarqueeSelectionChange.mock.calls.filter(
          ([, intent]) => intent?.cancelled === true,
        ).length;

      await renderCanvas({ activeTool: "move", clearSelectionRequest: 1 });

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:selectable-rects-result",
              correlationId: delayedReplies[0]!.correlationId,
              payload: delayedReplies[0]!.payload,
            },
            source: screenB.contentWindow,
          }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        onLayerMarqueeSelectionChange.mock.calls.filter(
          ([, intent]) => intent?.final === true,
        ),
      ).toHaveLength(0);
      expect(
        onLayerMarqueeSelectionChange.mock.calls.filter(
          ([, intent]) => intent?.cancelled === true,
        ),
      ).toHaveLength(cancellationsBeforeDraftChange + 1);
    } finally {
      postMessageSpies.forEach((spy) => spy.mockRestore());
    }
  });

  it("cancels a released marquee on Escape without accepting a late reply", async () => {
    const {
      clientPointForCanvas,
      delayedReplies,
      onLayerMarqueeSelectionChange,
      postMessageSpies,
      screenB,
      surface,
    } = await renderDelayedTwoScreenMarquee();
    const origin = clientPointForCanvas(100, -20);
    const end = clientPointForCanvas(600, 100);

    try {
      await act(async () => {
        dispatchMouse(surface, "mousedown", origin.clientX, origin.clientY);
        dispatchMouse(window, "mousemove", end.clientX, end.clientY);
        await nextAnimationFrame();
        await Promise.resolve();
        await Promise.resolve();
        dispatchMouse(window, "mouseup", end.clientX, end.clientY);
        await Promise.resolve();
      });
      expect(delayedReplies).toHaveLength(1);

      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      });

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:selectable-rects-result",
              correlationId: delayedReplies[0]!.correlationId,
              payload: delayedReplies[0]!.payload,
            },
            source: screenB.contentWindow,
          }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        onLayerMarqueeSelectionChange.mock.calls.filter(
          ([, intent]) => intent?.final === true,
        ),
      ).toHaveLength(0);
      expect(
        onLayerMarqueeSelectionChange.mock.calls.filter(
          ([, intent]) => intent?.cancelled === true,
        ),
      ).toHaveLength(1);
      expect(
        onLayerMarqueeSelectionChange.mock.calls.find(
          ([, intent]) => intent?.cancelled === true,
        )?.[1],
      ).toMatchObject({ restoreHostSelection: true });
    } finally {
      postMessageSpies.forEach((spy) => spy.mockRestore());
    }
  });

  it("caches the surface rect across marquee move frames", async () => {
    const onLayerMarqueeSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[]}
          zoom={100}
          activeTool="move"
          onPick={() => {}}
          onLayerMarqueeSelectionChange={onLayerMarqueeSelectionChange}
        />,
      );
    });
    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();
    const surfaceRectSpy = vi.spyOn(surface!, "getBoundingClientRect");
    surfaceRectSpy.mockClear();

    await act(async () => {
      dispatchMouse(surface!, "mousedown", 100, 100);
      for (const point of [140, 180, 220, 260]) {
        dispatchMouse(window, "mousemove", point, point);
        await nextAnimationFrame();
      }
      dispatchMouse(window, "mouseup", 260, 260);
    });

    expect(surfaceRectSpy).toHaveBeenCalledTimes(1);
    surfaceRectSpy.mockRestore();
  });

  it("keeps the selection box moving when the drag also selects the frame", async () => {
    const { frame, label } = await renderSelectedFrame(320, false);
    expect(container.querySelector("[data-frame-selection-box]")).toBeNull();

    await act(async () => {
      dispatchMouse(label, "mousedown", 320, 100);
    });

    const selectionBox = container.querySelector<HTMLElement>(
      "[data-frame-selection-box]",
    );
    expect(selectionBox).not.toBeNull();
    const before = {
      frameLeft: Number.parseFloat(frame.style.left),
      frameTop: Number.parseFloat(frame.style.top),
      boxLeft: Number.parseFloat(selectionBox!.style.left),
      boxTop: Number.parseFloat(selectionBox!.style.top),
    };

    await act(async () => {
      dispatchMouse(window, "mousemove", 355, 125);
      await nextAnimationFrame();
    });

    const frameDelta = {
      x: Number.parseFloat(frame.style.left) - before.frameLeft,
      y: Number.parseFloat(frame.style.top) - before.frameTop,
    };
    const boxDelta = {
      x: Number.parseFloat(selectionBox!.style.left) - before.boxLeft,
      y: Number.parseFloat(selectionBox!.style.top) - before.boxTop,
    };
    expect(frameDelta).toEqual(boxDelta);

    await act(async () => {
      dispatchMouse(window, "mouseup", 355, 125);
    });
  });

  it("reserves an empty screen body for frame selection", async () => {
    const onPick = vi.fn();
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
          geometryById={{
            "screen-a": { x: 0, y: 0, width: 320, height: 640 },
          }}
          renderScreenContent={() => (
            <div className="design-canvas-iframe-wrapper" />
          )}
          onPick={onPick}
        />,
      );
    });
    const interactiveBody = container.querySelector<HTMLElement>(
      ".design-canvas-iframe-wrapper",
    );
    const screenCard =
      container.querySelector<HTMLElement>("[data-screen-card]");
    expect(interactiveBody).not.toBeNull();
    expect(screenCard).not.toBeNull();
    expect(interactiveBody?.parentElement?.style.pointerEvents).toBe("none");

    await act(async () => {
      screenCard!.click();
    });

    expect(onPick).toHaveBeenCalledWith("screen-a");
    expect(
      container.querySelector("[data-frame-selection-box]"),
    ).not.toBeNull();
    expect(interactiveBody?.parentElement?.style.pointerEvents).toBe("auto");
  });

  it("keeps screen content with child layers interactive before frame selection", async () => {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "screen-a.html",
              content:
                "<!doctype html><html><body><button>Layer</button></body></html>",
            },
          ]}
          zoom={100}
          activeTool="move"
          geometryById={{
            "screen-a": { x: 0, y: 0, width: 320, height: 640 },
          }}
          renderScreenContent={() => (
            <div className="design-canvas-iframe-wrapper" />
          )}
          onPick={() => {}}
        />,
      );
    });

    const interactiveBody = container.querySelector<HTMLElement>(
      ".design-canvas-iframe-wrapper",
    );
    expect(interactiveBody?.parentElement?.style.pointerEvents).toBe("auto");
  });

  it("reserves live URL screen bodies for frame selection until selected", async () => {
    const render = async (selectedScreenIds: string[] = []) => {
      await act(async () => {
        root.render(
          <MultiScreenCanvas
            screens={[
              {
                id: "screen-a",
                filename: "screen-a.html",
                content: "http://localhost:3102/library",
                sourceType: "localhost",
              },
            ]}
            zoom={100}
            activeTool="move"
            selectedScreenIds={selectedScreenIds}
            geometryById={{
              "screen-a": { x: 0, y: 0, width: 320, height: 640 },
            }}
            renderScreenContent={() => (
              <div className="design-canvas-iframe-wrapper" />
            )}
            onPick={() => {}}
          />,
        );
      });
    };

    await render();
    const interactiveBody = container.querySelector<HTMLElement>(
      ".design-canvas-iframe-wrapper",
    );
    expect(interactiveBody?.parentElement?.style.pointerEvents).toBe("none");

    await render(["screen-a"]);
    expect(interactiveBody?.parentElement?.style.pointerEvents).toBe("auto");
  });

  it("drags a selected frame from its selection outline", async () => {
    const { frame } = await renderSelectedFrame();
    const dragSurface = container.querySelector<HTMLElement>(
      "[data-frame-drag-surface]",
    );
    expect(dragSurface).not.toBeNull();
    const before = { left: frame.style.left, top: frame.style.top };

    await act(async () => {
      dispatchMouse(dragSurface!, "mousedown", 320, 740);
      dispatchMouse(window, "mousemove", 355, 765);
      await nextAnimationFrame();
    });

    expect(frame.style.left).not.toBe(before.left);
    expect(frame.style.top).not.toBe(before.top);

    await act(async () => {
      dispatchMouse(window, "mouseup", 355, 765);
    });
  });

  it.each([
    "[data-frame-drag-surface]",
    "[data-frame-label]",
    "[data-screen-card]",
  ])("constrains a Shift-started screen drag from %s", async (selector) => {
    const { frame } = await renderSelectedFrame();
    const target = container.querySelector<HTMLElement>(selector)!;
    const before = { left: frame.style.left, top: frame.style.top };

    await act(async () => {
      dispatchMouse(target, "mousedown", 320, 400, { shiftKey: true });
      dispatchMouse(window, "mousemove", 355, 405, { shiftKey: true });
      await nextAnimationFrame();
      dispatchMouse(window, "mouseup", 355, 405, { shiftKey: true });
      dispatchMouse(target, "click", 355, 405, { shiftKey: true });
    });

    expect(Number.parseFloat(frame.style.left)).toBeGreaterThan(
      Number.parseFloat(before.left),
    );
    expect(frame.style.top).toBe(before.top);
    expect(
      container.querySelector("[data-frame-selection-box]"),
    ).not.toBeNull();
  });

  it.each([
    "[data-frame-drag-surface]",
    "[data-frame-label]",
    "[data-screen-card]",
  ])(
    "preserves Shift-click deselection without moving from %s",
    async (selector) => {
      const { onGeometryChange } = await renderSelectedFrame();
      const target = container.querySelector<HTMLElement>(selector)!;

      await act(async () => {
        dispatchMouse(target, "mousedown", 320, 400, { shiftKey: true });
        dispatchMouse(window, "mouseup", 320, 400, { shiftKey: true });
        dispatchMouse(target, "click", 320, 400, { shiftKey: true });
      });

      expect(onGeometryChange).toHaveBeenLastCalledWith({
        "screen-a": { x: 0, y: 0, width: 320, height: 640 },
      });
      expect(container.querySelector("[data-frame-selection-box]")).toBeNull();
    },
  );

  it("arms a shift+drag on a screen frame and constrains it to the dominant axis", async () => {
    const { frame } = await renderSelectedFrame();
    const dragSurface = container.querySelector<HTMLElement>(
      "[data-frame-drag-surface]",
    );
    expect(dragSurface).not.toBeNull();
    const before = { left: frame.style.left, top: frame.style.top };

    // Regression for beginFrameDrag's old `if (e.shiftKey) return;` bail,
    // which silently dropped shift+drag instead of arming a move. dx (80)
    // dominates dy (10), so the constrained move must land purely on X.
    await act(async () => {
      dispatchMouseShift(dragSurface!, "mousedown", 320, 740);
      dispatchMouseShift(window, "mousemove", 400, 750);
      await nextAnimationFrame();
    });

    expect(frame.style.left).not.toBe(before.left);
    expect(frame.style.top).toBe(before.top);

    await act(async () => {
      dispatchMouseShift(window, "mouseup", 400, 750);
    });
  });

  it("toggles an already-selected screen out of the selection on a no-move Shift+click via the drag surface", async () => {
    await renderSelectedFrame();
    const dragSurface = container.querySelector<HTMLElement>(
      "[data-frame-drag-surface]",
    );
    expect(dragSurface).not.toBeNull();
    expect(
      container.querySelector("[data-frame-selection-box]"),
    ).not.toBeNull();

    // Regression: this overlay owns the mousedown for an already-selected
    // frame and stops it from ever reaching handleFrameClick underneath, so
    // a no-move Shift release must replicate its toggle-out itself.
    await act(async () => {
      dispatchMouseShift(dragSurface!, "mousedown", 320, 740);
      dispatchMouseShift(window, "mouseup", 320, 740);
    });

    expect(container.querySelector("[data-frame-selection-box]")).toBeNull();
  });

  it("drags every screen in a multi-selection from the group outline", async () => {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "screen-a.html",
              content: "<!doctype html><html><body></body></html>",
            },
            {
              id: "screen-b",
              filename: "screen-b.html",
              content: "<!doctype html><html><body></body></html>",
            },
          ]}
          zoom={100}
          activeTool="move"
          selectedScreenIds={["screen-a", "screen-b"]}
          geometryById={{
            "screen-a": { x: 0, y: 0, width: 320, height: 640 },
            "screen-b": { x: 420, y: 100, width: 320, height: 640 },
          }}
          onPick={() => {}}
        />,
      );
    });
    const frameA = container.querySelector<HTMLElement>(
      '[data-frame-id="screen-a"]',
    );
    const frameB = container.querySelector<HTMLElement>(
      '[data-frame-id="screen-b"]',
    );
    const dragSurface = container.querySelector<HTMLElement>(
      "[data-frame-drag-surface]",
    );
    expect(frameA).not.toBeNull();
    expect(frameB).not.toBeNull();
    expect(dragSurface).not.toBeNull();
    const beforeA = { left: frameA!.style.left, top: frameA!.style.top };
    const beforeB = { left: frameB!.style.left, top: frameB!.style.top };

    await act(async () => {
      dispatchMouse(dragSurface!, "mousedown", 450, 450);
      dispatchMouse(window, "mousemove", 490, 480);
      await nextAnimationFrame();
    });

    const deltaA = {
      x:
        Number.parseFloat(frameA!.style.left) - Number.parseFloat(beforeA.left),
      y: Number.parseFloat(frameA!.style.top) - Number.parseFloat(beforeA.top),
    };
    const deltaB = {
      x:
        Number.parseFloat(frameB!.style.left) - Number.parseFloat(beforeB.left),
      y: Number.parseFloat(frameB!.style.top) - Number.parseFloat(beforeB.top),
    };
    expect(deltaA.x).not.toBe(0);
    expect(deltaA.y).not.toBe(0);
    expect(deltaB.x).toBeCloseTo(deltaA.x);
    expect(deltaB.y).toBeCloseTo(deltaA.y);

    await act(async () => {
      dispatchMouse(window, "mouseup", 490, 480);
    });
  });

  it("leaves Cmd+D for the layer hotkey when no frame is selected", async () => {
    const onDuplicate = vi.fn();
    const rendered = (selectedScreenIds: string[]) => (
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
        selectedScreenIds={selectedScreenIds}
        geometryById={{ "screen-a": { x: 0, y: 0, width: 320, height: 640 } }}
        onDuplicate={onDuplicate}
        onPick={() => {}}
      />
    );
    const pressDuplicate = () => {
      const event = new KeyboardEvent("keydown", {
        key: "d",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      return event;
    };

    await act(async () => {
      root.render(rendered([]));
    });
    let event = await act(async () => pressDuplicate());
    // The shared hotkey hook drops anything already defaultPrevented, so
    // claiming the event here would silently swallow layer duplication.
    expect(event.defaultPrevented).toBe(false);
    expect(onDuplicate).not.toHaveBeenCalled();

    await act(async () => {
      root.render(rendered(["screen-a"]));
    });
    event = await act(async () => pressDuplicate());
    expect(event.defaultPrevented).toBe(true);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDuplicate.mock.calls[0]![0]).toBe("screen-a");
  });

  it("duplicates a multi-selection on Cmd+D as one selected batch", async () => {
    const duplicateResolvers: Array<() => void> = [];
    const onDuplicate = vi.fn(
      (id: string, _request: DuplicateRequest) =>
        new Promise<string>((resolve) => {
          duplicateResolvers.push(() => resolve(`duplicate-${id}`));
        }),
    );
    const onSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "screen-a.html",
              content: "<!doctype html><html><body></body></html>",
            },
            {
              id: "screen-b",
              filename: "screen-b.html",
              content: "<!doctype html><html><body></body></html>",
            },
          ]}
          zoom={100}
          activeTool="move"
          selectedScreenIds={["screen-a", "screen-b"]}
          geometryById={{
            "screen-a": { x: 0, y: 0, width: 320, height: 640 },
            "screen-b": { x: 420, y: 0, width: 320, height: 640 },
          }}
          onDuplicate={onDuplicate}
          onSelectionChange={onSelectionChange}
          onPick={() => {}}
        />,
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "d",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onDuplicate).toHaveBeenCalledTimes(2);
    expect(
      new Set(
        onDuplicate.mock.calls.map(([, request]) => request.historyBatchId),
      ).size,
    ).toBe(1);

    await act(async () => {
      duplicateResolvers.forEach((resolve) => resolve());
      await Promise.resolve();
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith([
      "duplicate-screen-a",
      "duplicate-screen-b",
    ]);
  });

  it("copies a selected frame on alt-drag from its selection outline instead of moving it", async () => {
    const onDuplicate = vi.fn();
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
          onDuplicate={onDuplicate}
          onPick={() => {}}
        />,
      );
    });
    const frame = container.querySelector<HTMLElement>(
      '[data-frame-id="screen-a"]',
    );
    const dragSurface = container.querySelector<HTMLElement>(
      "[data-frame-drag-surface]",
    );
    expect(frame).not.toBeNull();
    expect(dragSurface).not.toBeNull();
    const before = { left: frame!.style.left, top: frame!.style.top };

    await act(async () => {
      dispatchMouseAlt(dragSurface!, "mousedown", 320, 400);
      dispatchMouseAlt(window, "mousemove", 400, 460);
      await nextAnimationFrame();
      dispatchMouseAlt(window, "mouseup", 400, 460);
    });

    expect(frame!.style.left).toBe(before.left);
    expect(frame!.style.top).toBe(before.top);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    const [duplicatedId, request] = onDuplicate.mock.calls[0]!;
    expect(duplicatedId).toBe("screen-a");
    expect(request.mode).toBe("alt-drag");
    expect(request.canvasPosition.x).toBeGreaterThan(0);
    expect(request.canvasPosition.y).toBeGreaterThan(0);
  });

  it("copies every frame in a multi-selection on alt-drag, keeping their relative layout", async () => {
    const duplicateResolvers: Array<(id: string) => void> = [];
    const onDuplicate = vi.fn(
      (id: string, _request: DuplicateRequest) =>
        new Promise<string>((resolve) => {
          duplicateResolvers.push(() => resolve(`duplicate-${id}`));
        }),
    );
    const onSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "screen-a.html",
              content: "<!doctype html><html><body></body></html>",
            },
            {
              id: "screen-b",
              filename: "screen-b.html",
              content: "<!doctype html><html><body></body></html>",
            },
          ]}
          zoom={100}
          activeTool="move"
          selectedScreenIds={["screen-a", "screen-b"]}
          geometryById={{
            "screen-a": { x: 0, y: 0, width: 320, height: 640 },
            "screen-b": { x: 420, y: 100, width: 320, height: 640 },
          }}
          onDuplicate={onDuplicate}
          onSelectionChange={onSelectionChange}
          onPick={() => {}}
        />,
      );
    });
    const frameA = container.querySelector<HTMLElement>(
      '[data-frame-id="screen-a"]',
    );
    const dragSurface = container.querySelector<HTMLElement>(
      "[data-frame-drag-surface]",
    );
    expect(frameA).not.toBeNull();
    expect(dragSurface).not.toBeNull();
    const beforeA = { left: frameA!.style.left, top: frameA!.style.top };

    await act(async () => {
      dispatchMouseAlt(dragSurface!, "mousedown", 450, 450);
      dispatchMouseAlt(window, "mousemove", 490, 480);
      await nextAnimationFrame();
      dispatchMouseAlt(window, "mouseup", 490, 480);
    });

    expect(frameA!.style.left).toBe(beforeA.left);
    expect(frameA!.style.top).toBe(beforeA.top);
    expect(onDuplicate).toHaveBeenCalledTimes(2);
    const placed = new Map<string, { x: number; y: number }>(
      onDuplicate.mock.calls.map(([duplicatedId, request]) => [
        duplicatedId,
        request.canvasPosition,
      ]),
    );
    const placedA = placed.get("screen-a")!;
    const placedB = placed.get("screen-b")!;
    expect(placedA.x).toBeGreaterThan(0);
    expect(placedB.x - placedA.x).toBeCloseTo(420);
    expect(placedB.y - placedA.y).toBeCloseTo(100);

    await act(async () => {
      duplicateResolvers.forEach((resolve) => resolve("done"));
      await Promise.resolve();
    });
    expect(onSelectionChange).toHaveBeenLastCalledWith([
      "duplicate-screen-a",
      "duplicate-screen-b",
    ]);
  });

  it("keeps pending review discoverable in constant-size frame chrome", async () => {
    const onReviewPendingScreen = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-review",
              filename: "review.html",
              content: "<!doctype html><html><body></body></html>",
            },
          ]}
          zoom={25}
          activeId="screen-review"
          pendingReviewScreenIds={new Set(["screen-review"])}
          onReviewPendingScreen={onReviewPendingScreen}
          geometryById={{
            "screen-review": { x: 0, y: 0, width: 320, height: 640 },
          }}
          onPick={() => {}}
        />,
      );
    });

    const badge = container.querySelector<HTMLButtonElement>(
      "[data-node-rewrite-review-badge]",
    );
    expect(badge?.textContent).toContain(
      "designEditor.nodeRewrite.reviewCandidate",
    );
    // Counter-scaled to stay a constant screen size at 25% zoom. The live
    // value comes from the --an-chrome-scale custom property that
    // applyViewToDom writes every gesture frame; React still renders the same
    // number as the var's fallback, which is what this asserts.
    expect(
      badge?.closest<HTMLElement>("[data-frame-label]")?.style.transform,
    ).toContain("scale(var(--an-chrome-scale, 4))");
    await act(async () => badge?.click());
    expect(onReviewPendingScreen).toHaveBeenCalledWith("screen-review");
  });

  it("keeps the Interact action inside narrow frames as a compact icon", async () => {
    const { frame } = await renderSelectedFrame(240);
    const fullView = frame.querySelector<HTMLElement>("[data-frame-full-view]");
    const fullViewLabel = fullView?.querySelector("span");

    expect(fullView).not.toBeNull();
    expect(fullView!.getAttribute("data-compact")).toBe("true");
    expect(fullView!.classList.contains("left-1/2")).toBe(true);
    expect(fullView!.classList.contains("-translate-x-1/2")).toBe(true);
    expect(fullView!.classList.contains("w-5")).toBe(true);
    expect(fullView!.style.maxWidth).toBe("20px");
    expect(fullViewLabel?.classList.contains("sr-only")).toBe(true);
    expect(fullView!.getAttribute("aria-label")).toBe(
      "designEditor.modes.interact",
    );
  });

  it("hides narrow breakpoint width suffixes without truncating the device label", async () => {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "screen-a.html",
              content: "<!doctype html><html><body></body></html>",
              breakpointWidths: [390, 768],
            },
          ]}
          zoom={100}
          activeTool="move"
          metadataById={{ "screen-a": { width: 1280, height: 640 } }}
          geometryById={{
            "screen-a": { x: 0, y: 0, width: 320, height: 160 },
          }}
          onPick={() => {}}
        />,
      );
    });

    const breakpointFrames = container.querySelectorAll<HTMLElement>(
      "[data-breakpoint-frame]",
    );
    expect(breakpointFrames).toHaveLength(2);
    expect(
      breakpointFrames[0]?.querySelector("[data-breakpoint-width]"),
    ).toBeNull();
    expect(
      breakpointFrames[1]?.querySelector("[data-breakpoint-width]"),
    ).not.toBeNull();
    expect(
      breakpointFrames[0]?.querySelector("[data-frame-title]")?.textContent,
    ).toBe("Mobile");
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

  it.each(["release", "Escape", "unmount"])(
    "portals transform feedback at viewport coordinates and removes it on %s",
    async (cleanup) => {
      rectSpy.mockReturnValue({
        x: 160,
        y: 80,
        top: 80,
        right: 960,
        bottom: 680,
        left: 160,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      });
      const surface = await renderHarness("rect");
      const draft = await createSelectedDraft(surface);
      const resizeHandle = container.querySelector<HTMLElement>(
        '[data-frame-selection-box] [data-resize-handle="se"]',
      );
      expect(resizeHandle).not.toBeNull();
      expect(surface.style.contain).toBe("layout paint");
      const beforeWidth = draft.style.width;

      await act(async () => {
        dispatchMouse(resizeHandle!, "mousedown", 400, 400);
        dispatchMouse(window, "mousemove", 450, 450);
        await nextAnimationFrame();
      });

      const badge = document.querySelector<HTMLElement>(
        "[data-transform-badge]",
      );
      expect(draft.style.width).not.toBe(beforeWidth);
      expect(badge).not.toBeNull();
      expect(badge!.parentElement).toBe(document.body);
      expect(surface.contains(badge)).toBe(false);
      expect(badge!.style.left).toBe("462px");
      expect(badge!.style.top).toBe("462px");
      expect(badge!.classList.contains("fixed")).toBe(true);
      expect(badge!.classList.contains("bg-background/95")).toBe(true);
      expect(badge!.classList.contains("text-foreground")).toBe(true);
      expect(badge!.textContent).toBe(
        `${Math.round(Number.parseFloat(draft.style.width))} x ${Math.round(Number.parseFloat(draft.style.height))}`,
      );

      await act(async () => {
        if (cleanup === "release") {
          dispatchMouse(window, "mouseup", 450, 450);
        } else if (cleanup === "Escape") {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        } else {
          root.render(null);
        }
      });
      expect(document.querySelector("[data-transform-badge]")).toBeNull();
      expect(badge!.isConnected).toBe(false);
    },
  );

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

    await act(async () => {
      dispatchMouseShift(surface!, "mousedown", origin.clientX, origin.clientY);
      dispatchMouseShift(
        window,
        "mousemove",
        jittered.clientX,
        jittered.clientY,
      );
      dispatchMouseShift(window, "mouseup", jittered.clientX, jittered.clientY);
    });

    expect(
      container.querySelector("[data-frame-selection-box]"),
    ).not.toBeNull();
  });

  it("requires full enclosure to marquee-select a top-level screen, unlike a shape's intersect rule", async () => {
    // screen-a spans canvas x:[0,320] y:[0,640] (renderSelectedFrame's
    // default geometry). Ground truth: a top-level frame only joins the
    // marquee selection once the box fully contains it — mere intersection
    // (Figma's rule for shapes/board objects) must not select it.
    await renderSelectedFrame(320, false);
    const surface = container.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(surface).not.toBeNull();
    expect(container.querySelector("[data-frame-selection-box]")).toBeNull();

    const worldLayer = surface!.firstElementChild as HTMLElement;
    const transformMatch = worldLayer.style.transform.match(
      /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/,
    );
    expect(transformMatch).not.toBeNull();
    const [, panXStr, panYStr, scaleStr] = transformMatch!;
    const panX = Number.parseFloat(panXStr);
    const panY = Number.parseFloat(panYStr);
    const scale = Number.parseFloat(scaleStr);
    const clientPointForCanvas = (canvasX: number, canvasY: number) => ({
      clientX: panX + (SURFACE_PADDING + canvasX) * scale,
      clientY: panY + (SURFACE_PADDING + canvasY) * scale,
    });

    // A marquee box that only clips the frame's right edge (well above the
    // frame's top so the mousedown starts on empty canvas, not the label).
    const partialOrigin = clientPointForCanvas(340, -100);
    const partialEnd = clientPointForCanvas(300, 40);
    await act(async () => {
      dispatchMouse(
        surface!,
        "mousedown",
        partialOrigin.clientX,
        partialOrigin.clientY,
      );
      dispatchMouse(
        window,
        "mousemove",
        partialEnd.clientX,
        partialEnd.clientY,
      );
      dispatchMouse(window, "mouseup", partialEnd.clientX, partialEnd.clientY);
    });
    expect(
      container.querySelector("[data-frame-selection-box]"),
      "a marquee that only clips the screen's edge must not select it",
    ).toBeNull();

    // Now fully enclose the frame.
    const fullOrigin = clientPointForCanvas(-40, -100);
    const fullEnd = clientPointForCanvas(360, 700);
    await act(async () => {
      dispatchMouse(
        surface!,
        "mousedown",
        fullOrigin.clientX,
        fullOrigin.clientY,
      );
      dispatchMouse(window, "mousemove", fullEnd.clientX, fullEnd.clientY);
      dispatchMouse(window, "mouseup", fullEnd.clientX, fullEnd.clientY);
    });
    expect(
      container.querySelector("[data-frame-selection-box]"),
      "fully enclosing the screen with the marquee must select it",
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

  it("commits the rotated frame geometry on mouseup", async () => {
    const onGeometryCommit = vi.fn();
    await renderSelectedFrame(320, true, onGeometryCommit);
    const selectionBox = container.querySelector<HTMLElement>(
      "[data-frame-selection-box]",
    );
    const rotateHandle = selectionBox?.querySelector<HTMLElement>(
      "[data-rotate-handle]",
    );
    expect(rotateHandle).not.toBeNull();

    await act(async () => {
      dispatchMouse(rotateHandle!, "mousedown", 500, 100);
      dispatchMouse(window, "mousemove", 560, 100);
      await nextAnimationFrame();
      dispatchMouse(window, "mouseup", 560, 100);
    });

    expect(onGeometryCommit).toHaveBeenCalledTimes(1);
    expect(
      onGeometryCommit.mock.calls[0]?.[0]?.["screen-a"]?.rotation ?? 0,
    ).toBe(0);
    expect(
      onGeometryCommit.mock.calls[0]?.[1]?.["screen-a"]?.rotation,
    ).not.toBe(0);
  });

  it("disables only the focused screen's resize handles in Interact", async () => {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            { id: "screen-a", filename: "screen-a.html", content: "" },
            { id: "screen-b", filename: "screen-b.html", content: "" },
          ]}
          zoom={100}
          activeTool="move"
          activeId="screen-a"
          selectedScreenIds={["screen-a"]}
          interactScreenId="screen-a"
          focusedInteractViewport={{ width: 390, height: 844 }}
          geometryById={{
            "screen-a": { x: 0, y: 0, width: 390, height: 844 },
            "screen-b": { x: 500, y: 0, width: 390, height: 844 },
          }}
          onPick={() => {}}
        />,
      );
    });

    const focusedFrame = container.querySelector<HTMLElement>(
      '[data-frame-id="screen-a"]',
    );
    const otherFrame = container.querySelector<HTMLElement>(
      '[data-frame-id="screen-b"]',
    );
    expect(focusedFrame).not.toBeNull();
    expect(otherFrame).not.toBeNull();
    expect(focusedFrame!.querySelector("[data-resize-handle]")).toBeNull();
    expect(
      container.querySelector(
        "[data-frame-selection-box] [data-resize-handle]",
      ),
    ).toBeNull();
    expect(otherFrame!.querySelector("[data-resize-handle]")).not.toBeNull();
  });

  it("uses the focused device viewport for near-matching aspect ratios", async () => {
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "screen-a.html",
              content: "<!doctype html><html><body>Preview</body></html>",
            },
          ]}
          zoom={100}
          activeTool="move"
          activeId="screen-a"
          interactMode
          interactScreenId="screen-a"
          focusedInteractViewport={{ width: 402, height: 874 }}
          metadataById={{
            "screen-a": { width: 390, height: 844 },
          }}
          geometryById={{
            "screen-a": { x: 0, y: 0, width: 390, height: 844 },
          }}
          onPick={() => {}}
        />,
      );
    });

    const iframe = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="screen-a"]',
    );
    expect(iframe).not.toBeNull();
    expect(iframe!.style.width).toBe("402px");
    expect(iframe!.style.height).toBe("874px");
    expect(iframe!.style.transform).toBe("");
  });

  it("resizes a frame and restores it when Escape cancels the drag", async () => {
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

    // Resize commits through the shared geometry state during the gesture, so
    // the frame, screen card, and selection box all stay on the same geometry
    // boundary. Confirm those surfaces update during the live gesture rather
    // than only when the gesture ends.
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

    // Escape must roll back the shared geometry state, otherwise the frame
    // stays visually stuck at its last dragged size.
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

  it("keeps content-fit height and breakpoint companions in sync during a side resize", async () => {
    const onGeometryChange = vi.fn();
    const onGeometryCommit = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            {
              id: "screen-a",
              filename: "screen-a.html",
              content: "<!doctype html><html><body></body></html>",
              breakpointWidths: [390],
            },
          ]}
          zoom={100}
          activeTool="move"
          activeId="screen-a"
          selectedScreenIds={["screen-a"]}
          metadataById={{ "screen-a": { width: 1440, height: 900 } }}
          geometryById={{
            "screen-a": { x: 0, y: 0, width: 320, height: 200 },
          }}
          onPick={() => {}}
          onGeometryChange={onGeometryChange}
          onGeometryCommit={onGeometryCommit}
        />,
      );
    });

    const frame = container.querySelector<HTMLElement>(
      '[data-frame-id="screen-a"]',
    );
    const primaryIframe = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="screen-a"]',
    );
    const selectionBox = container.querySelector<HTMLElement>(
      "[data-frame-selection-box]",
    );
    const resizeHandle = selectionBox?.querySelector<HTMLElement>(
      '[data-resize-handle="e"]',
    );
    const screenCard = frame?.querySelector<HTMLElement>("[data-screen-card]");
    const breakpointFrame = container.querySelector<HTMLElement>(
      "[data-breakpoint-frame]",
    );
    expect(primaryIframe).not.toBeNull();
    expect(resizeHandle).not.toBeNull();
    expect(screenCard).not.toBeNull();
    expect(breakpointFrame).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:content-size",
            width: 1440,
            height: 1200,
            viewportHeight: 900,
          },
          source: primaryIframe!.contentWindow,
        }),
      );
    });

    expect(screenCard!.style.height).toBe("1200px");
    expect(selectionBox!.style.height).toBe("1200px");
    const beforeCompanionLeft = breakpointFrame!.style.left;

    await act(async () => {
      dispatchMouse(resizeHandle!, "mousedown", 400, 400);
      dispatchMouse(window, "mousemove", 450, 400);
      await nextAnimationFrame();
    });

    expect(screenCard!.style.width).toBe("370px");
    expect(screenCard!.style.height).toBe("1200px");
    expect(selectionBox!.style.width).toBe("370px");
    expect(selectionBox!.style.height).toBe("1200px");
    expect(breakpointFrame!.style.left).not.toBe(beforeCompanionLeft);
    expect(onGeometryChange).not.toHaveBeenCalled();

    await act(async () => {
      dispatchMouse(window, "mouseup", 450, 400);
    });

    expect(onGeometryChange).toHaveBeenCalledTimes(1);
    expect(onGeometryCommit).toHaveBeenCalledTimes(1);
    expect(onGeometryCommit.mock.calls[0]?.[1]).toMatchObject({
      "screen-a": { width: 370, height: 1200 },
    });
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
      // The board colour is painted on the layer, not baked into the srcdoc:
      // inside the document it would be part of the iframe's identity, so every
      // colour-picker tick would rebuild the frame and drop in-iframe state.
      expect(boardLayer!.style.background).toBe(
        "var(--design-editor-canvas-bg)",
      );
      expect(iframe!.srcdoc).not.toContain("background:hsl(");
      expect(iframe!.getAttribute("data-screen-iframe-id")).toBeNull();
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
      expect(staticIframe!.srcdoc).toContain(
        "html,body{background:transparent!important",
      );
      expect(staticIframe!.style.background).toBe(
        "var(--design-editor-canvas-bg)",
      );
      expect(staticIframe!.srcdoc).not.toContain("<script");

      const initialActiveIframe = activeIframe!;
      const initialActiveSrcdoc = initialActiveIframe.srcdoc;
      const initialActiveLeft = activeLayer!.style.left;
      const postMessage = vi.spyOn(
        initialActiveIframe.contentWindow!,
        "postMessage",
      );

      // The mount-time board-fit effect centers the lone board content in
      // the viewport, so pan is not {0,0} here — derive the click point from
      // the transform it actually committed rather than assuming a fixed
      // pan. right-edge sits at canvas (35000, 100) (see the fixture above):
      // visible near the viewport's right edge but outside the centered
      // 24,576-world-pixel live iframe.
      const worldLayer = container.querySelector<HTMLElement>(
        "[data-multi-screen-canvas-world]",
      );
      expect(worldLayer).not.toBeNull();
      const transformMatch = worldLayer!.style.transform.match(
        /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/,
      );
      expect(transformMatch).not.toBeNull();
      const [, panXStr, panYStr, scaleStr] = transformMatch!;
      const panX = Number.parseFloat(panXStr);
      const panY = Number.parseFloat(panYStr);
      const scale = Number.parseFloat(scaleStr);
      const rightEdgeClick = {
        clientX: panX + (SURFACE_PADDING + 35000) * scale,
        clientY: panY + (SURFACE_PADDING + 100) * scale,
      };

      await act(async () => {
        dispatchMouse(
          surface!,
          "mousedown",
          rightEdgeClick.clientX,
          rightEdgeClick.clientY,
        );
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

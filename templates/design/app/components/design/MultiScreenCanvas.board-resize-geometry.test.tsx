// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MultiScreenCanvas } from "./MultiScreenCanvas";

type BoardSelectionWorldBoundsChange = NonNullable<
  ComponentProps<typeof MultiScreenCanvas>["onBoardSelectionWorldBoundsChange"]
>;
type BoardSelectionWorldBounds = Exclude<
  Parameters<BoardSelectionWorldBoundsChange>[0],
  null
>;
type RenderCanvasOptions = {
  boardFileId?: string;
  boardFileContent?: string;
  screens?: ComponentProps<typeof MultiScreenCanvas>["screens"];
  geometryById?: ComponentProps<typeof MultiScreenCanvas>["geometryById"];
  onBoardSelectionWorldBoundsChange?: BoardSelectionWorldBoundsChange;
  selectedLayerSelectorGroupsByScreen?: Record<string, string[][]>;
  boardSelectedSelector?: string;
  boardSelectedSourceId?: string;
};

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const BOARD_CONTENT = `<!doctype html><html><body>
  <div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" style="position:absolute;left:0px;top:0px;width:50px;height:50px"></div>
  <div data-agent-native-edge-handle="e"></div>
</body></html>`;
const BOARD_NEGATIVE_CONTENT = `<!doctype html><html><body>
  <div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" style="position:absolute;left:-1200px;top:100px;width:120px;height:90px"></div>
</body></html>`;
const BOARD_SELECTOR = "[data-agent-native-node-id='rect-1']";

let container: HTMLDivElement;
let root: Root;
let rectSpy: ReturnType<typeof vi.spyOn>;

function renderCanvas(
  boardFrameGeometry: { x: number; y: number; width: number; height: number },
  options: RenderCanvasOptions = {},
) {
  return (
    <MultiScreenCanvas
      screens={options.screens ?? []}
      zoom={100}
      geometryById={options.geometryById ?? {}}
      boardFileId={options.boardFileId ?? "board"}
      boardFileContent={options.boardFileContent ?? BOARD_CONTENT}
      boardFrameGeometry={boardFrameGeometry}
      boardIsActive
      onBoardSelectionWorldBoundsChange={
        options.onBoardSelectionWorldBoundsChange
      }
      selectedLayerSelectorGroupsByScreen={
        options.selectedLayerSelectorGroupsByScreen
      }
      boardSelectedSelector={options.boardSelectedSelector ?? BOARD_SELECTOR}
      boardSelectedSourceId={options.boardSelectedSourceId ?? "rect-1"}
      onPick={() => {}}
    />
  );
}

async function mountBoardCanvas(
  boardFrameGeometry: { x: number; y: number; width: number; height: number },
  options: RenderCanvasOptions = {},
): Promise<HTMLIFrameElement> {
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
  await act(async () => {
    root.render(renderCanvas(boardFrameGeometry, options));
  });
  // Let the board iframe's srcdoc finish loading into a real contentDocument.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const boardIframe = container.querySelector<HTMLIFrameElement>(
    "[data-board-surface-layer] iframe[data-design-preview-iframe]",
  );
  expect(boardIframe).not.toBeNull();
  return boardIframe!;
}

function postBoardSelectionRect(
  source: Window | null,
  overrides: Partial<{
    screenId: string;
    selector: string;
    sourceId: string;
    contentOffsetX: number;
    contentOffsetY: number;
    rect: { left: number; top: number; width: number; height: number } | null;
    rotationDeg: number;
  }> = {},
) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "agent-native:board-selection-rect",
        screenId: "board",
        selector: BOARD_SELECTOR,
        sourceId: "rect-1",
        contentOffsetX: 0,
        contentOffsetY: 0,
        rect: { left: 10, top: 10, width: 50, height: 50 },
        rotationDeg: 0,
        ...overrides,
      },
      source,
    }),
  );
}

function postBoardSelectionBounds(source: Window | null) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "agent-native:board-selection-bounds",
        screenId: "board",
        selector: BOARD_SELECTOR,
        memberSelectors: [BOARD_SELECTOR, "#rect-2"],
        memberSourceIds: ["rect-1", "rect-2"],
        contentOffsetX: 4096,
        contentOffsetY: 4096,
        rect: { left: 2896, top: 4196, width: 220, height: 190 },
        rotationDeg: 0,
      },
      source,
    }),
  );
}

async function nextAnimationFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

afterEach(async () => {
  await act(async () => root.unmount());
  rectSpy.mockRestore();
  container.remove();
});

/**
 * The board bridge runs same-origin content the host also renders inside every
 * Screen's preview iframe, so the selection-rect listener must key on the
 * board surface's OWN contentWindow — a rect from any other window would plant
 * host-level resize handles (wired straight into startResize) over geometry
 * that window does not own.
 */
describe("board-selection-rect sender boundary", () => {
  it("ignores the rect unless it came from the board surface iframe's own contentWindow", async () => {
    const boardIframe = await mountBoardCanvas({
      x: -1000,
      y: -1000,
      width: 2000,
      height: 2000,
    });
    const foreignIframe = document.createElement("iframe");
    document.body.append(foreignIframe);
    try {
      expect(foreignIframe.contentWindow).not.toBeNull();
      expect(foreignIframe.contentWindow).not.toBe(boardIframe.contentWindow);

      await act(async () => {
        postBoardSelectionRect(foreignIframe.contentWindow);
      });
      expect(
        container.querySelector("[data-board-object-selection-box]"),
      ).toBeNull();

      // Same payload from the board surface itself does render chrome, so the
      // assertion above is a real source check and not a dead payload.
      await act(async () => {
        postBoardSelectionRect(boardIframe.contentWindow);
      });
      expect(
        container.querySelector("[data-board-object-selection-box]"),
      ).not.toBeNull();
    } finally {
      foreignIframe.remove();
    }
  });
});

describe("board selection world-bounds handoff", () => {
  it("reports a bounds-only multi-selection without replacing resize chrome", async () => {
    const onSelectionChange = vi.fn<BoardSelectionWorldBoundsChange>();
    const boardIframe = await mountBoardCanvas(
      { x: -65_536, y: -65_536, width: 131_072, height: 131_072 },
      {
        onBoardSelectionWorldBoundsChange: onSelectionChange,
        selectedLayerSelectorGroupsByScreen: {
          board: [[BOARD_SELECTOR], ["#rect-2"]],
        },
        boardSelectedSourceId: "rect-1",
      },
    );

    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow);
      postBoardSelectionBounds(boardIframe.contentWindow);
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      screenId: "board",
      selector: BOARD_SELECTOR,
      memberSelectors: [BOARD_SELECTOR, "#rect-2"],
      memberSourceIds: ["rect-1", "rect-2"],
      worldBounds: {
        left: -1200,
        top: 100,
        right: -980,
        bottom: 290,
        width: 220,
        height: 190,
        centerX: -1090,
        centerY: 195,
      },
    });
    expect(
      container.querySelector("[data-board-object-selection-box]"),
    ).toBeNull();

    await act(async () => {
      root.render(
        renderCanvas(
          { x: -65_536, y: -65_536, width: 131_072, height: 131_072 },
          {
            onBoardSelectionWorldBoundsChange: onSelectionChange,
            selectedLayerSelectorGroupsByScreen: { board: [["#rect-2"]] },
            boardSelectedSourceId: "rect-2",
          },
        ),
      );
    });
    expect(
      container.querySelector("[data-board-object-selection-box]"),
    ).toBeNull();

    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow, {
        selector: "#rect-2",
        sourceId: "rect-2",
      });
    });
    expect(
      container.querySelector("[data-board-object-selection-box]"),
    ).not.toBeNull();
  });

  it("reports the exact negative-X world rect from the current board render window", async () => {
    const onSelectionChange = vi.fn<BoardSelectionWorldBoundsChange>();
    const boardIframe = await mountBoardCanvas(
      { x: -65_536, y: -65_536, width: 131_072, height: 131_072 },
      {
        boardFileContent: BOARD_NEGATIVE_CONTENT,
        onBoardSelectionWorldBoundsChange: onSelectionChange,
      },
    );

    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow, {
        rect: { left: 2896, top: 4196, width: 120, height: 90 },
        contentOffsetX: 4096,
        contentOffsetY: 4096,
      });
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      screenId: "board",
      selector: BOARD_SELECTOR,
      worldBounds: {
        left: -1200,
        top: 100,
        right: -1080,
        bottom: 190,
        width: 120,
        height: 90,
        centerX: -1140,
        centerY: 145,
      },
    });
  });

  it("clears cached bounds on rect:null, board-document change, and unmount", async () => {
    let currentSelection: BoardSelectionWorldBounds | null = null;
    const onSelectionChange = vi.fn(
      (selection: BoardSelectionWorldBounds | null) => {
        currentSelection = selection;
      },
    );
    const boardGeometry = {
      x: -65_536,
      y: -65_536,
      width: 131_072,
      height: 131_072,
    };
    const boardIframe = await mountBoardCanvas(boardGeometry, {
      onBoardSelectionWorldBoundsChange: onSelectionChange,
    });

    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow);
    });
    expect(currentSelection).not.toBeNull();

    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow, { rect: null });
    });
    expect(currentSelection).toBeNull();

    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow);
    });
    expect(currentSelection).not.toBeNull();
    onSelectionChange.mockClear();

    await act(async () => {
      root.render(
        renderCanvas(boardGeometry, {
          boardFileId: "board-next",
          onBoardSelectionWorldBoundsChange: onSelectionChange,
        }),
      );
    });
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    expect(currentSelection).toBeNull();

    onSelectionChange.mockClear();
    await act(async () => root.render(null));
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    expect(currentSelection).toBeNull();
  });

  it("clears instead of caching a selection that names another screen", async () => {
    let currentSelection: BoardSelectionWorldBounds | null = null;
    const onSelectionChange = vi.fn(
      (selection: BoardSelectionWorldBounds | null) => {
        currentSelection = selection;
      },
    );
    const boardIframe = await mountBoardCanvas(
      { x: -65_536, y: -65_536, width: 131_072, height: 131_072 },
      { onBoardSelectionWorldBoundsChange: onSelectionChange },
    );

    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow, {
        screenId: "screen-other",
      });
    });
    expect(currentSelection).toBeNull();
  });
});

describe("board element drag target resolution", () => {
  it("keeps a screen drop owned by the host when selection chrome masks the card", async () => {
    const frameGeometry = { x: 0, y: 0, width: 800, height: 600 };
    const boardIframe = await mountBoardCanvas(frameGeometry, {
      screens: [
        {
          id: "screen-1",
          filename: "screen-1.html",
          content: "<!doctype html><html><body></body></html>",
        },
      ],
      geometryById: { "screen-1": frameGeometry },
    });

    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow, {
        rect: { left: 0, top: 0, width: 800, height: 600 },
      });
    });

    const dragSurface = container.querySelector<HTMLElement>(
      "[data-board-object-selection-box] [data-frame-drag-surface]",
    );
    expect(dragSurface).not.toBeNull();

    const selectionOverlay =
      boardIframe.contentWindow!.document.createElement("div");
    selectionOverlay.setAttribute(
      "data-agent-native-edit-overlay",
      "selection",
    );
    boardIframe.contentWindow!.document.body.append(selectionOverlay);
    const iframeDoc = boardIframe.contentWindow!.document;
    const forwardedEvents: string[] = [];
    iframeDoc.addEventListener("mouseup", () =>
      forwardedEvents.push("mouseup"),
    );
    const postMessage = vi.spyOn(boardIframe.contentWindow!, "postMessage");
    const elementFromPoint = vi
      .spyOn(document, "elementFromPoint")
      .mockReturnValue(
        container.querySelector("[data-board-object-selection-box]")!,
      );

    try {
      await act(async () => {
        dragSurface!.dispatchEvent(
          new MouseEvent("mousedown", {
            clientX: 400,
            clientY: 150,
            button: 0,
            buttons: 1,
            bubbles: true,
            cancelable: true,
          }),
        );
        window.dispatchEvent(
          new MouseEvent("mousemove", {
            clientX: 420,
            clientY: 170,
            buttons: 1,
            bubbles: true,
            cancelable: true,
          }),
        );
        await nextAnimationFrame();
        window.dispatchEvent(
          new MouseEvent("mouseup", {
            clientX: 420,
            clientY: 170,
            button: 0,
            buttons: 0,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    } finally {
      elementFromPoint.mockRestore();
    }

    const cancelMessage = postMessage.mock.calls.find(
      ([message]) =>
        (message as { type?: string }).type ===
        "agent-native:cancel-active-drag",
    );
    expect(cancelMessage).toBeDefined();
    expect(forwardedEvents).not.toContain("mouseup");
  });
});

/**
 * beginBoardElementResize's move/up handlers are captured once at mousedown
 * and outlive any later render. If they map through the render geometry
 * captured in that mousedown-time closure instead of re-reading it fresh, a
 * wheel/pinch zoom mid-resize (not blocked during a drag) silently maps
 * every subsequent point through a stale origin. Proven here by shifting
 * `boardFrameGeometry` — a simpler, deterministic driver of the same
 * `boardSurfaceRenderGeometry` the real zoom path also feeds — between
 * mousedown and mouseup, and asserting the point the host forwards into the
 * board iframe shifts by exactly the geometry's own delta.
 */
describe("beginBoardElementResize point mapping", () => {
  it("maps mouseup through the render geometry current at mouseup, not the one captured at mousedown", async () => {
    const boardIframe = await mountBoardCanvas({
      x: -1000,
      y: -1000,
      width: 2000,
      height: 2000,
    });
    const iframeDoc = boardIframe.contentWindow!.document;

    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow);
    });

    const handle = container.querySelector<HTMLElement>(
      '[data-board-object-selection-box] [data-resize-handle="e"]',
    );
    expect(handle).not.toBeNull();

    const dispatchedPoints: Array<{ type: string; x: number; y: number }> = [];
    iframeDoc.addEventListener("mousedown", (ev) =>
      dispatchedPoints.push({
        type: "mousedown",
        x: (ev as MouseEvent).clientX,
        y: (ev as MouseEvent).clientY,
      }),
    );
    iframeDoc.addEventListener("mouseup", (ev) =>
      dispatchedPoints.push({
        type: "mouseup",
        x: (ev as MouseEvent).clientX,
        y: (ev as MouseEvent).clientY,
      }),
    );

    await act(async () => {
      handle!.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 400,
          clientY: 300,
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // Shift the render geometry's origin by (+100, +40) — the render must
    // pick this up before the drag ends.
    await act(async () => {
      root.render(
        renderCanvas({ x: -900, y: -960, width: 2000, height: 2000 }),
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          clientX: 400,
          clientY: 300,
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const mousedownPoint = dispatchedPoints.find((p) => p.type === "mousedown");
    const mouseupPoint = dispatchedPoints.find((p) => p.type === "mouseup");
    expect(mousedownPoint).toBeDefined();
    expect(mouseupPoint).toBeDefined();

    // Same client point, only the render geometry's origin shifted by
    // (+100, +40) between mousedown and mouseup — a mapping that re-reads
    // fresh geometry must shift the mapped point by the OPPOSITE delta
    // (-100, -40); a mapping stuck on the stale mousedown-time geometry
    // would report the exact same point twice.
    expect(mouseupPoint!.x - mousedownPoint!.x).toBeCloseTo(-100);
    expect(mouseupPoint!.y - mousedownPoint!.y).toBeCloseTo(-40);
  });

  it.each(["Escape", "blur"] as const)(
    "cancels a moved Board resize on host %s without forwarding mouseup",
    async (hostEvent) => {
      const boardIframe = await mountBoardCanvas({
        x: -1000,
        y: -1000,
        width: 2000,
        height: 2000,
      });
      const iframeDoc = boardIframe.contentWindow!.document;
      const postMessage = vi.spyOn(boardIframe.contentWindow!, "postMessage");

      await act(async () => {
        postBoardSelectionRect(boardIframe.contentWindow);
      });
      const handle = container.querySelector<HTMLElement>(
        '[data-board-object-selection-box] [data-resize-handle="e"]',
      );
      expect(handle).not.toBeNull();

      const forwardedEvents: string[] = [];
      for (const type of ["mousedown", "mousemove", "mouseup"]) {
        iframeDoc.addEventListener(type, () => forwardedEvents.push(type));
      }
      postMessage.mockClear();

      await act(async () => {
        handle!.dispatchEvent(
          new MouseEvent("mousedown", {
            clientX: 400,
            clientY: 300,
            button: 0,
            buttons: 1,
            bubbles: true,
            cancelable: true,
          }),
        );
        window.dispatchEvent(
          new MouseEvent("mousemove", {
            clientX: 450,
            clientY: 300,
            buttons: 1,
            bubbles: true,
            cancelable: true,
          }),
        );
        await nextAnimationFrame();
      });
      expect(forwardedEvents).toEqual(["mousedown", "mousemove"]);

      await act(async () => {
        window.dispatchEvent(
          hostEvent === "Escape"
            ? new KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
                cancelable: true,
              })
            : new Event("blur"),
        );
      });

      const cancelMessage = postMessage.mock.calls.find(
        ([message]) =>
          (message as { type?: string }).type ===
          "agent-native:cancel-active-drag",
      )?.[0] as { type: string; pressedAt?: number } | undefined;
      expect(cancelMessage?.type).toBe("agent-native:cancel-active-drag");
      expect(cancelMessage?.pressedAt).toBeGreaterThan(1_000_000_000_000);
      expect(forwardedEvents).not.toContain("mouseup");

      const forwardedCount = forwardedEvents.length;
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      expect(forwardedEvents).toHaveLength(forwardedCount);
    },
  );
});

describe("board text editing", () => {
  it("drops the host drag surface while a board text edit owns the pointer", async () => {
    const boardIframe = await mountBoardCanvas({
      x: -1000,
      y: -1000,
      width: 2000,
      height: 2000,
    });
    const postTextEditingState = (active: boolean) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "text-editing-state",
            active,
            selector: BOARD_SELECTOR,
            sourceId: "rect-1",
            hasRange: false,
          },
          origin: window.location.origin,
          source: boardIframe.contentWindow,
        }),
      );
    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow);
    });
    expect(
      container.querySelector("[data-board-object-selection-box]"),
    ).not.toBeNull();

    await act(async () => postTextEditingState(true));
    expect(
      container.querySelector("[data-board-object-selection-box]"),
    ).toBeNull();

    await act(async () => postTextEditingState(false));
    expect(
      container.querySelector("[data-board-object-selection-box]"),
    ).not.toBeNull();
  });
});

describe("board selection box click", () => {
  it("hands a click without movement to the board bridge through its shield", async () => {
    const boardIframe = await mountBoardCanvas({
      x: -1000,
      y: -1000,
      width: 2000,
      height: 2000,
    });
    const frameDoc = boardIframe.contentDocument!;
    const shield = frameDoc.createElement("div");
    shield.setAttribute("data-agent-native-edit-overlay", "shield");
    const selection = frameDoc.createElement("div");
    selection.setAttribute("data-agent-native-edit-overlay", "selection");
    frameDoc.body.append(shield, selection);
    const received: string[] = [];
    for (const type of ["mousedown", "mouseup"]) {
      shield.addEventListener(type, () => received.push(`shield:${type}`));
      selection.addEventListener(type, () =>
        received.push(`selection:${type}`),
      );
    }
    await act(async () => {
      postBoardSelectionRect(boardIframe.contentWindow);
    });
    const surface = container.querySelector<HTMLElement>(
      "[data-board-object-selection-box] [data-frame-drag-surface]",
    )!;
    await act(async () => {
      surface.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 30,
          clientY: 30,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 31,
          clientY: 30,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 31, clientY: 30 }),
      );
    });
    expect(received).toEqual(["shield:mousedown", "shield:mouseup"]);
  });
});

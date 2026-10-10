// @vitest-environment jsdom
// jsdom only: withMeasuredGeometry's regression test below measures a real
// (mocked) live-preview iframe node.

import type { CodeLayerNode, CodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import { resolveSelectedCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import { withMeasuredGeometry } from "@/pages/design-editor/editor-helpers";

import { runScreenElementSelect } from "./screen-element-select";

if (typeof CSS === "undefined" || !CSS.escape) {
  (globalThis as { CSS?: { escape: (value: string) => string } }).CSS = {
    escape: (value: string) => value,
  };
}

function makeNode(id: string): CodeLayerNode {
  return {
    id,
    tag: "div",
    layerName: id,
    layerNameSource: "tag",
    selector: `#${id}`,
    selectors: [`#${id}`],
    path: `#${id}`,
    attributes: {},
    dataAttributes: { "data-agent-native-node-id": id },
    classes: [],
    textSnippet: null,
    paintsOwnText: false,
    repeatXFor: null,
    style: {},
    styleTokens: [],
    children: [],
    layout: {
      siblingIndex: 0,
      nthOfType: 1,
      isFlexContainer: false,
      isGridContainer: false,
    },
    capabilities: [],
    confidence: 1,
    source: null,
  };
}

function makeInfo(id: string): ElementInfo {
  return { tagName: "DIV", sourceId: id, selector: `#${id}` } as ElementInfo;
}

function makeArgs(overrides: {
  selectedLayerIdsState: string[];
  nodes: CodeLayerNode[];
  onSelectedLayerIdsChange: (next: string[]) => void;
  onSelectedElementChange?: (next: ElementInfo | null) => void;
}) {
  return {
    activeBreakpointWidthStateRef: { current: undefined },
    applyFileContentUpdate: vi.fn(),
    clearPendingOverviewLayerSelectionTimer: vi.fn(),
    focusDesignInspectorForSelection: vi.fn(),
    getCodeLayerProjectionForScreen: () =>
      ({ nodes: overrides.nodes }) as unknown as CodeLayerProjection,
    getScreenContent: () => "",
    handleBreakpointBarSelect: vi.fn(),
    id: "design-1",
    createdOverviewLayerSelection: null,
    pendingOverviewLayerSelectionRef: { current: null },
    pendingOverviewScreenSelectionRef: { current: null },
    revealLayer: () => {},
    selectedElementRef: { current: null },
    selectedLayerIdsState: overrides.selectedLayerIdsState,
    setActiveFileId: vi.fn(),
    setActiveTool: vi.fn(),
    setCreatedOverviewLayerSelection: vi.fn(),
    setHoveredElement: vi.fn(),
    setHoveredElementScreenId: vi.fn(),
    setMode: vi.fn(),
    setOverviewSelectedScreenIds: vi.fn(),
    setSelectedElement: (
      next:
        | ElementInfo
        | null
        | ((prev: ElementInfo | null) => ElementInfo | null),
    ) => {
      const resolved = typeof next === "function" ? next(null) : next;
      overrides.onSelectedElementChange?.(resolved);
    },
    setSelectedLayerIdsState: (
      updater: string[] | ((current: string[]) => string[]),
    ) => {
      const next =
        typeof updater === "function"
          ? updater(overrides.selectedLayerIdsState)
          : updater;
      overrides.onSelectedLayerIdsChange(next);
    },
    shouldPreserveBlockedOverviewLayerSelectionRef: { current: () => false },
    t: (key: string) => key,
    viewModeRef: { current: "single" as const },
  };
}

describe("runScreenElementSelect — Shift+click toggles selection membership", () => {
  it("does not measure a duplicate selector from another Screen when the scoped iframe is absent", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    iframe.setAttribute("data-screen-iframe-id", "screen-other");
    document.body.appendChild(iframe);
    const target = iframe.contentDocument!.createElement("div");
    target.id = "node-a";
    iframe.contentDocument!.body.appendChild(target);
    target.getBoundingClientRect = () =>
      ({ x: 10, y: 20, width: 100, height: 40 }) as DOMRect;

    try {
      expect(
        withMeasuredGeometry(makeInfo("node-a"), "screen-missing").boundingRect,
      ).toBeUndefined();
      expect(withMeasuredGeometry(makeInfo("node-a")).boundingRect).toEqual({
        x: 10,
        y: 20,
        width: 100,
        height: 40,
      });
    } finally {
      document.body.removeChild(iframe);
    }
  });

  it("refreshes position context even when selection geometry is already present", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    document.body.appendChild(iframe);
    const target = iframe.contentDocument!.createElement("div");
    target.id = "node-a";
    target.style.position = "absolute";
    target.style.left = "100px";
    iframe.contentDocument!.body.appendChild(target);
    target.getBoundingClientRect = () =>
      ({ x: 100, y: 80, width: 100, height: 40 }) as DOMRect;

    try {
      const measured = withMeasuredGeometry({
        ...makeInfo("node-a"),
        boundingRect: { x: 100, y: 80, width: 100, height: 40 },
        positionReferenceRect: { x: 40, y: 30, width: 800, height: 600 },
      } as ElementInfo);

      expect(measured.positionReferenceRect).toMatchObject({ x: 0, y: 0 });
      expect(measured.positionContainingBlockOrigin).toEqual({ x: 0, y: 0 });
    } finally {
      document.body.removeChild(iframe);
    }
  });

  it("preserves the live board offset when refreshing Position geometry", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    const offset = doc.createElement("style");
    offset.setAttribute("data-agent-native-content-offset", "");
    offset.setAttribute("data-agent-native-content-offset-x", "4096");
    offset.setAttribute("data-agent-native-content-offset-y", "2048");
    doc.head.appendChild(offset);
    const target = doc.createElement("div");
    target.id = "node-a";
    target.setAttribute("data-agent-native-node-id", "node-a");
    target.style.position = "absolute";
    doc.body.appendChild(target);
    target.getBoundingClientRect = () =>
      ({ x: 4096, y: 2048, width: 100, height: 40 }) as DOMRect;
    try {
      const measured = withMeasuredGeometry(makeInfo("node-a"));
      expect(measured.boundingRect).toMatchObject({ x: 4096, y: 2048 });
      expect(measured.positionReferenceRect).toMatchObject({
        x: 4096,
        y: 2048,
      });
      expect(measured.positionContainingBlockOrigin).toEqual({
        x: 4096,
        y: 2048,
      });
    } finally {
      iframe.remove();
    }
  });

  it("retains one consistent geometry snapshot when the offset becomes unreadable", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    const offset = doc.createElement("style");
    offset.setAttribute("data-agent-native-content-offset", "");
    offset.setAttribute("data-agent-native-content-offset-x", "4096");
    offset.setAttribute("data-agent-native-content-offset-y", "2048");
    doc.head.appendChild(offset);
    const boardRoot = doc.createElement("div");
    boardRoot.setAttribute("data-agent-native-node-id", "board-root");
    const frame = doc.createElement("div");
    frame.setAttribute("data-an-primitive", "frame");
    frame.setAttribute("data-agent-native-node-id", "frame-a");
    frame.style.position = "relative";
    const target = doc.createElement("div");
    target.id = "node-a";
    target.setAttribute("data-agent-native-node-id", "node-a");
    target.style.position = "absolute";
    boardRoot.appendChild(frame);
    frame.appendChild(target);
    doc.body.appendChild(boardRoot);
    let moved = false;
    frame.getBoundingClientRect = () =>
      (moved
        ? { x: 5000, y: 3000, width: 900, height: 700 }
        : { x: 4096, y: 2048, width: 800, height: 600 }) as DOMRect;
    target.getBoundingClientRect = () =>
      (moved
        ? { x: 5020, y: 3030, width: 120, height: 60 }
        : { x: 4100, y: 2050, width: 100, height: 40 }) as DOMRect;
    const originalQuerySelector = doc.querySelector.bind(doc);

    try {
      const previous = withMeasuredGeometry(makeInfo("node-a"));
      expect(previous.boundingRect).toEqual({
        x: 4100,
        y: 2050,
        width: 100,
        height: 40,
      });
      expect(previous.parentBoundingRect).toEqual({
        x: 4096,
        y: 2048,
        width: 800,
        height: 600,
      });
      expect(previous.positionReferenceRect).toEqual({
        x: 4096,
        y: 2048,
        width: 800,
        height: 600,
      });

      moved = true;
      vi.spyOn(doc, "querySelector").mockImplementation((selector) => {
        if (selector === "style[data-agent-native-content-offset]") {
          throw new DOMException(
            "Offset style is unavailable",
            "SecurityError",
          );
        }
        return originalQuerySelector(selector);
      });

      const measured = withMeasuredGeometry(previous);

      expect(measured).toBe(previous);
    } finally {
      vi.restoreAllMocks();
      iframe.remove();
    }
  });

  it("refreshes live element and parent geometry with the position context", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    document.body.appendChild(iframe);
    const parent = iframe.contentDocument!.createElement("div");
    parent.id = "parent";
    parent.style.position = "relative";
    const target = iframe.contentDocument!.createElement("div");
    target.id = "node-a";
    target.style.position = "absolute";
    parent.appendChild(target);
    iframe.contentDocument!.body.appendChild(parent);
    let scrollX = 0;
    let scrollY = 0;
    let parentBox = { x: 50, y: 30, width: 300, height: 200 };
    let targetBox = { x: 120, y: 80, width: 100, height: 40 };
    Object.defineProperties(iframe.contentWindow!, {
      scrollX: { configurable: true, get: () => scrollX },
      scrollY: { configurable: true, get: () => scrollY },
    });
    parent.getBoundingClientRect = () => parentBox as DOMRect;
    target.getBoundingClientRect = () => targetBox as DOMRect;

    try {
      const previous = withMeasuredGeometry({
        ...makeInfo("node-a"),
        boundingRect: { x: 10, y: 20, width: 50, height: 25 },
        parentBoundingRect: { x: 0, y: 0, width: 100, height: 100 },
      } as ElementInfo);

      scrollX = 50;
      scrollY = 70;
      parentBox = { x: 110, y: 70, width: 300, height: 200 };
      targetBox = { x: 180, y: 120, width: 100, height: 40 };
      const measured = withMeasuredGeometry({
        ...previous,
      } as ElementInfo);

      expect(measured.boundingRect).toEqual({
        x: 230,
        y: 190,
        width: 100,
        height: 40,
      });
      expect(measured.parentBoundingRect).toEqual({
        x: 160,
        y: 140,
        width: 300,
        height: 200,
      });
      expect(measured.positionContainingBlockOrigin).toEqual({
        x: 160,
        y: 140,
      });
    } finally {
      document.body.removeChild(iframe);
    }
  });

  it("keeps the bridge's semantic parent for boolean operands", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    const boolean = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    boolean.setAttribute("data-an-primitive", "boolean");
    const mask = doc.createElementNS("http://www.w3.org/2000/svg", "mask");
    const operand = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    operand.id = "node-a";
    operand.setAttribute("data-an-primitive", "boolean-operand");
    boolean.appendChild(mask);
    mask.appendChild(operand);
    doc.body.appendChild(boolean);
    boolean.getBoundingClientRect = () =>
      ({ x: 20, y: 30, width: 160, height: 140 }) as DOMRect;
    mask.getBoundingClientRect = () =>
      ({ x: 5, y: 7, width: 20, height: 20 }) as DOMRect;
    operand.getBoundingClientRect = () =>
      ({ x: 100, y: 110, width: 80, height: 70 }) as DOMRect;

    try {
      const measured = withMeasuredGeometry(makeInfo("node-a"));

      expect(measured.parentBoundingRect).toEqual({
        x: 20,
        y: 30,
        width: 160,
        height: 140,
      });
    } finally {
      document.body.removeChild(iframe);
    }
  });

  it("refreshes boolean operand geometry from its SVG shape bounds", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    const boolean = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    boolean.setAttribute("data-an-primitive", "boolean");
    const mask = doc.createElementNS("http://www.w3.org/2000/svg", "mask");
    const operand = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    operand.id = "node-a";
    operand.setAttribute("data-an-primitive", "boolean-operand");
    boolean.appendChild(mask);
    mask.appendChild(operand);
    doc.body.appendChild(boolean);
    Object.defineProperties(operand, {
      getBBox: {
        configurable: true,
        value: () => ({ x: 10, y: 20, width: 30, height: 40 }),
      },
      getScreenCTM: {
        configurable: true,
        value: () => ({ a: 2, b: 0, c: 0, d: 3, e: 100, f: 200 }),
      },
    });
    operand.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 800, height: 600 }) as DOMRect;
    Object.defineProperties(iframe.contentWindow!, {
      scrollX: { configurable: true, value: 5 },
      scrollY: { configurable: true, value: 7 },
    });

    try {
      const measured = withMeasuredGeometry(makeInfo("node-a"));

      expect(measured.boundingRect).toEqual({
        x: 125,
        y: 267,
        width: 60,
        height: 120,
      });
    } finally {
      document.body.removeChild(iframe);
    }
  });

  it("uses viewport coordinates for fixed elements without a containing block", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    document.body.appendChild(iframe);
    const view = iframe.contentWindow!;
    Object.defineProperties(view, {
      scrollX: { configurable: true, value: 50 },
      scrollY: { configurable: true, value: 70 },
    });
    Object.defineProperties(view.document.documentElement, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    });
    const target = view.document.createElement("div");
    target.id = "node-a";
    target.style.position = "fixed";
    target.style.left = "35px";
    target.style.top = "24px";
    view.document.body.appendChild(target);
    target.getBoundingClientRect = () =>
      ({ x: 35, y: 24, width: 100, height: 40 }) as DOMRect;

    try {
      const measured = withMeasuredGeometry(makeInfo("node-a"));

      expect(measured.boundingRect).toEqual({
        x: 85,
        y: 94,
        width: 100,
        height: 40,
      });
      expect(measured.positionReferenceRect).toEqual({
        x: 50,
        y: 70,
        width: 640,
        height: 480,
      });
      expect(measured.positionContainingBlockOrigin).toEqual({ x: 50, y: 70 });
      const positionReferenceRect = measured.positionReferenceRect;
      if (!positionReferenceRect) {
        throw new Error("position reference rectangle was not measured");
      }
      expect(measured.boundingRect.x - positionReferenceRect.x).toBe(35);
      expect(measured.boundingRect.y - positionReferenceRect.y).toBe(24);
    } finally {
      document.body.removeChild(iframe);
    }
  });

  it("removes an already-selected element from a multi-selection (A+B selected, Shift+click A -> only B), and moves the primary selection to B", () => {
    const nodes = [makeNode("node-a"), makeNode("node-b")];
    let result: string[] = [];
    let selectedElement: ElementInfo | null = null;
    const args = makeArgs({
      selectedLayerIdsState: ["node-a", "node-b"],
      nodes,
      onSelectedLayerIdsChange: (next) => {
        result = next;
      },
      onSelectedElementChange: (next) => {
        selectedElement = next;
      },
    });

    runScreenElementSelect(args, "screen-1", makeInfo("node-a"), {
      shiftKey: true,
    });

    expect(result).toEqual(["node-b"]);
    const resolved = resolveSelectedCodeLayerNode({
      selectedElement,
      sourceProjection: { nodes } as unknown as CodeLayerProjection,
    });
    expect(resolved?.id).toBe("node-b");
  });

  it("measures the retargeted primary's live geometry instead of leaving elementInfoFromCodeLayerNode's zero rect (Shift+2 zoom-to-selection needs a real rect)", () => {
    const nodes = [makeNode("node-a"), makeNode("node-b")];
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    iframe.setAttribute("data-screen-iframe-id", "screen-1");
    document.body.appendChild(iframe);
    const target = iframe.contentDocument!.createElement("div");
    target.id = "node-b";
    iframe.contentDocument!.body.appendChild(target);
    target.getBoundingClientRect = () =>
      ({ x: 10, y: 20, width: 100, height: 40 }) as DOMRect;

    const captured: { current: ElementInfo | null } = { current: null };
    const args = makeArgs({
      selectedLayerIdsState: ["node-a", "node-b"],
      nodes,
      onSelectedLayerIdsChange: () => {},
      onSelectedElementChange: (next) => {
        captured.current = next;
      },
    });

    try {
      runScreenElementSelect(args, "screen-1", makeInfo("node-a"), {
        shiftKey: true,
      });

      expect(captured.current?.boundingRect).toEqual({
        x: 10,
        y: 20,
        width: 100,
        height: 40,
      });
    } finally {
      document.body.removeChild(iframe);
    }
  });

  it("adds an unselected element on Shift+click instead of removing it", () => {
    const nodes = [makeNode("node-a"), makeNode("node-b")];
    let result: string[] = [];
    const args = makeArgs({
      selectedLayerIdsState: ["node-a"],
      nodes,
      onSelectedLayerIdsChange: (next) => {
        result = next;
      },
    });

    runScreenElementSelect(args, "screen-1", makeInfo("node-b"), {
      shiftKey: true,
    });

    expect(result).toEqual(["node-a", "node-b"]);
  });

  it("never toggles off for Cmd/Ctrl+click — it replaces the selection instead", () => {
    const nodes = [makeNode("node-a"), makeNode("node-b")];
    let result: string[] = [];
    const args = makeArgs({
      selectedLayerIdsState: ["node-a", "node-b"],
      nodes,
      onSelectedLayerIdsChange: (next) => {
        result = next;
      },
    });

    runScreenElementSelect(args, "screen-1", makeInfo("node-a"), {
      metaKey: true,
    });

    expect(result).toEqual(["node-a"]);
  });
});

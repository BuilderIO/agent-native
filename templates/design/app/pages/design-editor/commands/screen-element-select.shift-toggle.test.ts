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

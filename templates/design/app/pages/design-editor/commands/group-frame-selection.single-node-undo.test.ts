import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { readYjsUndoSelection } from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

import { runFrameSelection } from "./frame-selection";
import { runGroupSelection } from "./group-selection";

/**
 * Figma parity: Cmd+G on a single object (canGroup allows 1+, "Figma groups
 * a single object too") and Cmd+Alt+G on a single object both wrap it in a
 * container. Undoing that must restore the canvas/inspector selection to
 * the element that was wrapped, not clear it — group/frame are only a true
 * multi-select gesture (selectedElement: null) when 2+ nodes were selected.
 */
const FIXTURE = `<body>
  <div data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha" style="position:absolute;left:20px;top:20px;width:100px;height:80px"></div>
</body>`;

function alphaId(): string {
  return buildCodeLayerProjection(FIXTURE).nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "alpha",
  )!.id;
}

const activeFile: DesignFile = {
  id: "index.html",
  filename: "index.html",
  fileType: "html",
  content: FIXTURE,
  createdAt: "",
  updatedAt: "",
};

describe("runGroupSelection: single-layer Cmd+G undo selection restore", () => {
  it("stamps the wrapped element (not null) as the pre-group selection", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [priorItem] },
    };
    const applyLocalContentUpdate = vi.fn(() => {
      undoManagerRef.current.undoStack.push({ meta: new Map() });
    });

    runGroupSelection({
      activeFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      codeLayerOwnerByNodeIdRef: { current: new Map() },
      contentHistorySelectionAfterRef: { current: new Map() },
      contentUndoStackRef: { current: [] },
      files: [activeFile],
      getFreshActiveContent: () => FIXTURE,
      overviewSelectedScreenIds: [],
      selectedLayerIdsState: [alphaId()],
      sendRuntimeLayerSemanticHandoff: () => false,
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef,
    } as unknown as Parameters<typeof runGroupSelection>[0]);

    const newItem = undoManagerRef.current.undoStack[1]!;
    const stamped = readYjsUndoSelection(newItem);
    expect(stamped?.selectedElement).not.toBeNull();
    expect(
      stamped?.selectedElement?.sourceId ?? stamped?.selectedElement?.selector,
    ).toBeTruthy();
  });
});

describe("runFrameSelection: single-layer Cmd+Alt+G undo selection restore", () => {
  it("stamps the framed element (not null) as the pre-frame selection", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [priorItem] },
    };
    const applyLocalContentUpdate = vi.fn(() => {
      undoManagerRef.current.undoStack.push({ meta: new Map() });
    });

    runFrameSelection({
      activeFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      contentHistorySelectionAfterRef: { current: new Map() },
      contentUndoStackRef: { current: [] },
      files: [activeFile],
      getFreshActiveContent: () => FIXTURE,
      overviewSelectedScreenIds: [],
      selectedLayerIdsState: [alphaId()],
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef,
    } as unknown as Parameters<typeof runFrameSelection>[0]);

    const newItem = undoManagerRef.current.undoStack[1]!;
    const stamped = readYjsUndoSelection(newItem);
    expect(stamped?.selectedElement).not.toBeNull();
    expect(
      stamped?.selectedElement?.sourceId ?? stamped?.selectedElement?.selector,
    ).toBeTruthy();
  });
});

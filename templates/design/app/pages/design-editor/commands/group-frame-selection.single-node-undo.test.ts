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

/**
 * Figma parity: a true multi-select Cmd+G (2+ nodes) has no single canonical
 * element (selectedElement stays null, unlike the single-node case above),
 * but undo must still restore BOTH original layer ids so the group can be
 * undone back to its exact pre-group multi-selection — never an empty
 * selection. Regression coverage for the e2e "redo re-selects the group
 * Cmd+G produced, not the pre-group selection it undid back to" scenario.
 */
const MULTI_FIXTURE = `<body>
  <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" style="position:absolute;left:20px;top:20px;width:100px;height:80px"></div>
  <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B" style="position:absolute;left:140px;top:20px;width:100px;height:80px"></div>
</body>`;

function multiNodeIds(): string[] {
  const projection = buildCodeLayerProjection(MULTI_FIXTURE);
  return ["box-a", "box-b"].map(
    (attrId) =>
      projection.nodes.find(
        (node) => node.dataAttributes["data-agent-native-node-id"] === attrId,
      )!.id,
  );
}

const multiActiveFile: DesignFile = {
  ...activeFile,
  content: MULTI_FIXTURE,
};

describe("runGroupSelection: multi-layer Cmd+G undo selection restore", () => {
  it("stamps both original layer ids (selectedElement null) as the pre-group selection", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [priorItem] },
    };
    const applyLocalContentUpdate = vi.fn(() => {
      undoManagerRef.current.undoStack.push({ meta: new Map() });
    });
    const ids = multiNodeIds();

    runGroupSelection({
      activeFile: multiActiveFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      codeLayerOwnerByNodeIdRef: { current: new Map() },
      contentHistorySelectionAfterRef: { current: new Map() },
      contentUndoStackRef: { current: [] },
      files: [multiActiveFile],
      getFreshActiveContent: () => MULTI_FIXTURE,
      overviewSelectedScreenIds: [],
      selectedLayerIdsState: ids,
      sendRuntimeLayerSemanticHandoff: () => false,
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef,
    } as unknown as Parameters<typeof runGroupSelection>[0]);

    const newItem = undoManagerRef.current.undoStack[1]!;
    const stamped = readYjsUndoSelection(newItem);
    expect(stamped?.selectedElement).toBeNull();
    expect(stamped?.selectedLayerIds).toEqual(ids);
    expect(stamped?.selectedLayerIds).toHaveLength(2);
  });
});

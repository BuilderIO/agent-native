import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { elementInfoFromCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import {
  readYjsUndoSelection,
  type ContentHistoryChange,
  type YjsUndoSelectionSnapshot,
} from "@/pages/design-editor/history";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runFrameSelection } from "./frame-selection";
import { runGroupSelection } from "./group-selection";

const FIXTURE = `<body>
  <div data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha" style="position:absolute;left:20px;top:20px;width:100px;height:80px"></div>
</body>`;

function originalAlphaNode() {
  const node = buildCodeLayerProjection(FIXTURE, {
    source: { kind: "design-file", fileId: "index.html" },
  }).nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === "alpha",
  );
  if (!node) throw new Error("Alpha fixture node is missing from its Screen");
  return node;
}

const activeFile: DesignFile = {
  id: "index.html",
  filename: "index.html",
  fileType: "html",
  content: FIXTURE,
  createdAt: "",
  updatedAt: "",
};

function acceptFixture(content: string) {
  const prepared = prepareCanonicalSourceContent(content, {
    fileId: activeFile.id,
    fileType: activeFile.fileType,
  });
  return {
    status: "accepted" as const,
    content: prepared.content,
    nodeIdMap: prepared.nodeIdMap,
  };
}

describe("runGroupSelection: single-layer Cmd+G undo selection restore", () => {
  it("stamps the wrapped element (not null) as the pre-group selection", () => {
    const originalNode = originalAlphaNode();
    const priorItem = { meta: new Map<unknown, unknown>() };
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [priorItem] },
    };
    const applyLocalContentUpdate = vi.fn((content: string) => {
      undoManagerRef.current.undoStack.push({ meta: new Map() });
      return acceptFixture(content);
    });

    runGroupSelection({
      activeFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      codeLayerOwnerByNodeIdRef: { current: new Map() },
      contentHistorySelectionAfterRef: { current: new Map() },
      contentUndoStackRef: { current: [] },
      localContentUndoStackRef: { current: [] },
      files: [activeFile],
      getFreshActiveContent: () => FIXTURE,
      overviewSelectedScreenIds: [],
      selectedLayerIdsState: [originalNode.id],
      sendRuntimeLayerSemanticHandoff: () => false,
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef,
    } as unknown as Parameters<typeof runGroupSelection>[0]);

    const newItem = undoManagerRef.current.undoStack[1]!;
    const stamped = readYjsUndoSelection(newItem);
    expect(stamped?.selectedElement).toEqual(
      elementInfoFromCodeLayerNode(originalNode),
    );
    expect(stamped?.selectedLayerIds).toEqual([originalNode.id]);
  });

  it("stamps the grouped layer as the local fallback redo selection", () => {
    const localContentUndoStackRef = {
      current: [] as ContentHistoryChange[],
    };
    const applyLocalContentUpdate = vi.fn(
      (
        content: string,
        options?: { selectionBefore?: YjsUndoSelectionSnapshot },
      ) => {
        const publication = acceptFixture(content);
        localContentUndoStackRef.current.push({
          fileId: activeFile.id,
          before: FIXTURE,
          after: publication.content,
          selectionBefore: options?.selectionBefore,
        });
        return publication;
      },
    );
    const originalNode = originalAlphaNode();

    runGroupSelection({
      activeFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      codeLayerOwnerByNodeIdRef: { current: new Map() },
      contentHistorySelectionAfterRef: { current: new Map() },
      contentUndoStackRef: { current: [] },
      localContentUndoStackRef,
      files: [activeFile],
      getFreshActiveContent: () => FIXTURE,
      overviewSelectedScreenIds: [],
      selectedLayerIdsState: [originalNode.id],
      sendRuntimeLayerSemanticHandoff: () => false,
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef: { current: null },
    } as unknown as Parameters<typeof runGroupSelection>[0]);

    const entry = localContentUndoStackRef.current[0]!;
    const wrapper = buildCodeLayerProjection(entry.after, {
      source: { kind: "design-file", fileId: activeFile.id },
    }).nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-group"] === "true",
    );
    expect(wrapper).toBeDefined();
    expect(entry.selectionAfter).toEqual({
      selectedElement: elementInfoFromCodeLayerNode(wrapper!),
      selectedLayerIds: [wrapper!.id],
    });
  });
});

describe("runFrameSelection: single-layer Cmd+Alt+G undo selection restore", () => {
  it("stamps the framed element (not null) as the pre-frame selection", () => {
    const originalNode = originalAlphaNode();
    const priorItem = { meta: new Map<unknown, unknown>() };
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [priorItem] },
    };
    const applyLocalContentUpdate = vi.fn((content: string) => {
      undoManagerRef.current.undoStack.push({ meta: new Map() });
      return acceptFixture(content);
    });

    runFrameSelection({
      activeFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      contentHistorySelectionAfterRef: { current: new Map() },
      contentUndoStackRef: { current: [] },
      localContentUndoStackRef: { current: [] },
      files: [activeFile],
      getFreshActiveContent: () => FIXTURE,
      overviewSelectedScreenIds: [],
      selectedLayerIdsState: [originalNode.id],
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef,
    } as unknown as Parameters<typeof runFrameSelection>[0]);

    const newItem = undoManagerRef.current.undoStack[1]!;
    const stamped = readYjsUndoSelection(newItem);
    expect(stamped?.selectedElement).toEqual(
      elementInfoFromCodeLayerNode(originalNode),
    );
    expect(stamped?.selectedLayerIds).toEqual([originalNode.id]);
  });

  it("stamps the framed layer as the local fallback redo selection", () => {
    const localContentUndoStackRef = {
      current: [] as ContentHistoryChange[],
    };
    const applyLocalContentUpdate = vi.fn(
      (
        content: string,
        options?: { selectionBefore?: YjsUndoSelectionSnapshot },
      ) => {
        const publication = acceptFixture(content);
        localContentUndoStackRef.current.push({
          fileId: activeFile.id,
          before: FIXTURE,
          after: publication.content,
          selectionBefore: options?.selectionBefore,
        });
        return publication;
      },
    );
    const originalNode = originalAlphaNode();

    runFrameSelection({
      activeFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      contentHistorySelectionAfterRef: { current: new Map() },
      contentUndoStackRef: { current: [] },
      localContentUndoStackRef,
      files: [activeFile],
      getFreshActiveContent: () => FIXTURE,
      overviewSelectedScreenIds: [],
      selectedLayerIdsState: [originalNode.id],
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef: { current: null },
    } as unknown as Parameters<typeof runFrameSelection>[0]);

    const entry = localContentUndoStackRef.current[0]!;
    const wrapper = buildCodeLayerProjection(entry.after, {
      source: { kind: "design-file", fileId: activeFile.id },
    }).nodes.find(
      (candidate) => candidate.dataAttributes["data-an-primitive"] === "frame",
    );
    expect(wrapper).toBeDefined();
    expect(entry.selectionAfter).toEqual({
      selectedElement: elementInfoFromCodeLayerNode(wrapper!),
      selectedLayerIds: [wrapper!.id],
    });
  });
});

const MULTI_FIXTURE = `<body>
  <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" style="position:absolute;left:20px;top:20px;width:100px;height:80px"></div>
  <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B" style="position:absolute;left:140px;top:20px;width:100px;height:80px"></div>
</body>`;

function multiNodeIds(): string[] {
  const projection = buildCodeLayerProjection(MULTI_FIXTURE, {
    source: { kind: "design-file", fileId: "index.html" },
  });
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
    const applyLocalContentUpdate = vi.fn((content: string) => {
      undoManagerRef.current.undoStack.push({ meta: new Map() });
      return acceptFixture(content);
    });
    const ids = multiNodeIds();

    runGroupSelection({
      activeFile: multiActiveFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      codeLayerOwnerByNodeIdRef: { current: new Map() },
      contentHistorySelectionAfterRef: { current: new Map() },
      contentUndoStackRef: { current: [] },
      localContentUndoStackRef: { current: [] },
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

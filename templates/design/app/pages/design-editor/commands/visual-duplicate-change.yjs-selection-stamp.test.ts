import { buildCodeLayerProjection } from "@shared/code-layer";
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { elementInfoFromCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import {
  type ContentHistoryChange,
  readYjsRedoSelection,
  readYjsUndoSelection,
  YJS_UNDO_SELECTION_META_KEY,
  type YjsUndoSelectionSnapshot,
} from "@/pages/design-editor/history";

import { runVisualDuplicateChange } from "./visual-duplicate-change";

const CONTENT = `<!doctype html><html><body><div id="rect" data-agent-native-node-id="rect"></div></body></html>`;
const SOURCE = { kind: "design-file" as const, fileId: "file-1" };

function baseArgs(overrides: {
  undoManagerRef: { current: { undoStack: any[] } | null };
  applyLocalContentUpdate: ReturnType<typeof vi.fn>;
  localContentUndoStackRef?: { current: ContentHistoryChange[] };
}) {
  const staleCopySelection = {
    selector: '[data-agent-native-node-id="rect-copy"]',
    sourceId: "rect-copy",
  } as any;
  return {
    args: {
      activeFile: { id: "file-1" },
      applyLocalContentUpdate: overrides.applyLocalContentUpdate,
      canEditDesign: true,
      getFreshActiveContent: () => CONTENT,
      localContentUndoStackRef: overrides.localContentUndoStackRef ?? {
        current: [],
      },
      selectedElement: staleCopySelection,
      selectedLayerIdsState: ["rect-copy"],
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      undoManagerRef: overrides.undoManagerRef,
    } as unknown as Parameters<typeof runVisualDuplicateChange>[0],
  };
}

function expectedOriginalSelection() {
  const projection = buildCodeLayerProjection(CONTENT, { source: SOURCE });
  const rectNode = projection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "rect",
  );
  if (!rectNode) throw new Error("Original rect fixture node is missing");
  return {
    selectedElement: elementInfoFromCodeLayerNode(rectNode),
    selectedLayerIds: [rectNode.id],
  };
}

describe("runVisualDuplicateChange — stamps the pre-duplicate (original) selection for undo", () => {
  it("stamps the ORIGINAL node's selection onto a NEW undo-stack item, not the stale copy selection", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    const undoManagerRef = { current: { undoStack: [priorItem] } };
    const applyLocalContentUpdate = vi.fn((content: string) => {
      undoManagerRef.current.undoStack.push({ meta: new Map() });
      return {
        status: "accepted",
        content,
        nodeIdMap: new Map(),
        yjsHistoryRecorded: true,
      };
    });

    const { args } = baseArgs({ undoManagerRef, applyLocalContentUpdate });

    runVisualDuplicateChange(
      args,
      '[data-agent-native-node-id="rect"]',
      '<div id="rect-copy" data-agent-native-node-id="rect-copy"></div>',
      undefined,
      { sourceId: "rect" },
    );

    const newItem = undoManagerRef.current.undoStack[1]!;
    const originalSelection = expectedOriginalSelection();
    expect(originalSelection.selectedElement.sourceId).toBe("rect");
    expect(readYjsUndoSelection(newItem)).toEqual(originalSelection);
    expect(readYjsUndoSelection(priorItem)).toBeUndefined();
  });

  it("does not stamp (or touch the existing stamp) when the write coalesces into the existing stack top", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    priorItem.meta.set("design-editor-selection-before", "earlier-gesture");
    const undoManagerRef = { current: { undoStack: [priorItem] } };
    const applyLocalContentUpdate = vi.fn((content: string) => ({
      status: "accepted",
      content,
      nodeIdMap: new Map(),
      yjsHistoryRecorded: false,
    }));

    const { args } = baseArgs({ undoManagerRef, applyLocalContentUpdate });

    const result = runVisualDuplicateChange(
      args,
      '[data-agent-native-node-id="rect"]',
      '<div id="rect-copy" data-agent-native-node-id="rect-copy"></div>',
      undefined,
      { sourceId: "rect" },
    );

    expect(result).toBe(true);
    expect(undoManagerRef.current.undoStack).toHaveLength(1);
    expect(readYjsUndoSelection(priorItem)).toBe("earlier-gesture");
  });

  it("updates the coalesced item's redo selection to the newly selected clone", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    const originalSelection = expectedOriginalSelection();
    priorItem.meta.set(YJS_UNDO_SELECTION_META_KEY, originalSelection);
    const undoManagerRef = { current: { undoStack: [priorItem] } };
    let updatedContent = CONTENT;
    const applyLocalContentUpdate = vi.fn((content: string) => {
      updatedContent = content;
      return {
        status: "accepted",
        content,
        nodeIdMap: new Map(),
        yjsHistoryRecorded: true,
      };
    });
    const { args } = baseArgs({ undoManagerRef, applyLocalContentUpdate });
    const copyElementInfo = {
      tagName: "DIV",
      id: "rect-copy",
      sourceId: "rect-copy",
      selector: '[data-agent-native-node-id="rect-copy"]',
      classes: [],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      textContent: "copy",
    } as any;

    runVisualDuplicateChange(
      args,
      '[data-agent-native-node-id="rect"]',
      '<div id="rect-copy" data-agent-native-node-id="rect-copy">copy</div>',
      copyElementInfo,
      { sourceId: "rect" },
    );

    const projection = buildCodeLayerProjection(updatedContent, {
      source: SOURCE,
    });
    const copyNode = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "rect-copy",
    );
    const selectedElementSetter = args.setSelectedElement as ReturnType<
      typeof vi.fn
    >;
    const selectedLayerIdsSetter = args.setSelectedLayerIdsState as ReturnType<
      typeof vi.fn
    >;
    const selectedElement =
      selectedElementSetter.mock.calls[
        selectedElementSetter.mock.calls.length - 1
      ]?.[0];
    const selectedLayerIds =
      selectedLayerIdsSetter.mock.calls[
        selectedLayerIdsSetter.mock.calls.length - 1
      ]?.[0];

    expect(copyNode).toBeDefined();
    expect(selectedElement?.sourceId).toBe("rect-copy");
    expect(selectedLayerIds).toEqual([copyNode!.id]);
    expect(readYjsUndoSelection(priorItem)).toEqual(originalSelection);
    expect(readYjsRedoSelection(priorItem)).toEqual({
      selectedElement,
      selectedLayerIds,
    });
  });

  it("stamps the clone selection onto the local fallback redo entry", () => {
    const localContentUndoStackRef = {
      current: [] as ContentHistoryChange[],
    };
    const applyLocalContentUpdate = vi.fn(
      (
        after: string,
        options?: { selectionBefore?: YjsUndoSelectionSnapshot },
      ) => {
        const publication = {
          status: "accepted" as const,
          content: after,
          nodeIdMap: new Map<string, string>(),
        };
        localContentUndoStackRef.current.push({
          fileId: "file-1",
          before: CONTENT,
          after,
          selectionBefore: options?.selectionBefore,
        });
        return publication;
      },
    );
    const { args } = baseArgs({
      undoManagerRef: { current: null },
      applyLocalContentUpdate,
      localContentUndoStackRef,
    });

    runVisualDuplicateChange(
      args,
      '[data-agent-native-node-id="rect"]',
      '<div id="rect-copy" data-agent-native-node-id="rect-copy">copy</div>',
      {
        tagName: "DIV",
        id: "rect-copy",
        sourceId: "rect-copy",
        selector: '[data-agent-native-node-id="rect-copy"]',
        classes: [],
        computedStyles: {},
        boundingRect: { x: 0, y: 0, width: 10, height: 10 },
        textContent: "copy",
      } as any,
      { sourceId: "rect" },
    );

    const entry = localContentUndoStackRef.current[0]!;
    const copyNode = buildCodeLayerProjection(entry.after, {
      source: SOURCE,
    }).nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "rect-copy",
    );
    expect(copyNode).toBeDefined();
    expect(entry.selectionAfter).toMatchObject({
      selectedElement: { sourceId: "rect-copy" },
      selectedLayerIds: [copyNode!.id],
    });
  });
});
